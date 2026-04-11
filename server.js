// 1. Importar las librerías
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const nodemailer = require('nodemailer');

// 2. Configuración inicial
const port = process.env.PORT || 3000; // Render usará una variable, nosotros usamos 3000
const MAX_TEXT_LENGTH = 1000;

// Configuración de email (variables de entorno)
const EMAIL_HOST     = process.env.EMAIL_HOST;
const EMAIL_PORT     = parseInt(process.env.EMAIL_PORT || '587', 10);
const EMAIL_USER     = process.env.EMAIL_USER;
const EMAIL_PASS     = process.env.EMAIL_PASS;
const EMAIL_FROM     = process.env.EMAIL_FROM || EMAIL_USER;
const EMAIL_TO       = process.env.EMAIL_TO;       // destinatario principal
const EMAIL_TO_2     = process.env.EMAIL_TO_2;     // segundo destinatario (opcional)

const app = express();
const server = http.createServer(app);

// Servir archivos estáticos desde /public
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Ruta HTTP raíz — devuelve la UI del chat (Magic)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta alternativa — devuelve la UI del chat (enigma)
app.get('/enigma', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'enigma.html'));
});

// Validación básica de formato de email
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Transporter reutilizable (sólo si el email está configurado)
const transporter = (EMAIL_HOST && EMAIL_USER && EMAIL_PASS)
  ? nodemailer.createTransport({
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      secure: EMAIL_PORT === 465,
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    })
  : null;

// Endpoint para el comando "attention": envía notificación por email
app.post('/api/attention', async (req, res) => {
  if (!transporter || !EMAIL_TO) {
    return res.status(503).json({ error: 'Email no configurado en el servidor.' });
  }

  // El cliente puede enviar un segundo destinatario en el cuerpo de la petición
  const rawEmail = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  if (rawEmail && !EMAIL_REGEX.test(rawEmail)) {
    return res.status(400).json({ error: 'La dirección de email proporcionada no es válida.' });
  }

  // Construir la lista de destinatarios
  const recipients = [EMAIL_TO];
  if (EMAIL_TO_2) recipients.push(EMAIL_TO_2);
  if (rawEmail) recipients.push(rawEmail);

  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: recipients.join(', '),
      subject: 'Notificación BIMtegracion',
      text: 'Tiene una nueva notificación en BIMtegracion.',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al enviar email:', err.message);
    res.status(500).json({ error: 'No se pudo enviar el email.' });
  }
});

// 3. Crear el servidor de WebSockets (sin path fijo — ruteamos manualmente)
const wss = new WebSocket.Server({ noServer: true });

// 4. La Lógica del Chat — dos salas independientes
const rooms = {
  magic:  { clients: [], nextId: 1 },
  enigma: { clients: [], nextId: 1 },
};

function handleConnection(ws, roomName) {
  const room = rooms[roomName];

  // --- A. CUANDO ALGUIEN NUEVO SE CONECTA ---
  // Limpiar sockets obsoletos antes de evaluar el aforo
  room.clients = room.clients.filter(c => c.socket.readyState === WebSocket.OPEN);

  if (room.clients.length >= 2) {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  // Reiniciar el contador cuando la sala está vacía
  if (room.clients.length === 0) {
    room.nextId = 1;
  }

  const clientId = room.nextId++;
  room.clients.push({ id: clientId, socket: ws });
  console.log(`[${roomName}] Cliente #${clientId} conectado.`);
  ws.send(JSON.stringify({ type: 'assign_id', id: clientId }));

  // Notificar a ambos lados si ya hay dos clientes
  if (room.clients.length === 2) {
    room.clients.forEach((client) => {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(JSON.stringify({ type: 'peer_connected' }));
      }
    });
  }

  // --- B. CUANDO RECIBIMOS UN MENSAJE ---
  ws.on('message', (message) => {
    try {
      const parsedMessage = JSON.parse(message);

      // Validar que el mensaje tenga los campos esperados
      if (!parsedMessage.id || typeof parsedMessage.text !== 'string') return;

      // Limitar la longitud del texto
      const text = parsedMessage.text.slice(0, MAX_TEXT_LENGTH);

      room.clients.forEach((client) => {
        if (client.id !== parsedMessage.id && client.socket.readyState === WebSocket.OPEN) {
          client.socket.send(JSON.stringify({
            type: 'chat_message',
            id: parsedMessage.id,
            text
          }));
        }
      });
    } catch (e) {
      console.error('Mensaje inválido recibido:', e.message);
    }
  });

  // --- C. CUANDO ALGUIEN SE DESCONECTA ---
  ws.on('close', () => {
    const closedClient = room.clients.find(client => client.socket === ws);
    if (closedClient) {
      room.clients = room.clients.filter(client => client.socket !== ws);
      console.log(`[${roomName}] Cliente #${closedClient.id} se ha desconectado.`);

      // Notificar al peer que el otro se desconectó
      room.clients.forEach((client) => {
        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.send(JSON.stringify({ type: 'peer_disconnected' }));
        }
      });
    }
  });
}

// Rutear upgrades HTTP → sala correcta según el path de la URL
server.on('upgrade', (req, socket, head) => {
  const url = req.url ? req.url.split('?')[0] : '';
  let roomName;
  if (url === '/ws/magic') {
    roomName = 'magic';
  } else if (url === '/ws/enigma') {
    roomName = 'enigma';
  } else {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    handleConnection(ws, roomName);
  });
});

// 5. Iniciar el servidor
server.listen(port, () => {
  console.log(`Servidor iniciado en el puerto ${port}`);
});