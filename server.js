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

// Ruta HTTP raíz — devuelve la UI del chat
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

// 3. Crear el servidor de WebSockets
const wss = new WebSocket.Server({ server });

// 4. La Lógica del Chat
let clients = [];
let nextId = 1; // Contador incremental para IDs únicos

wss.on('connection', (ws) => {
  // --- A. CUANDO ALGUIEN NUEVO SE CONECTA ---
  // Limpiar sockets obsoletos antes de evaluar el aforo
  clients = clients.filter(c => c.socket.readyState === WebSocket.OPEN);

  if (clients.length >= 2) {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  // Reiniciar el contador cuando la sala está vacía
  if (clients.length === 0) {
    nextId = 1;
  }

  const clientId = nextId++;
  clients.push({ id: clientId, socket: ws });
  console.log(`Cliente #${clientId} conectado.`);
  ws.send(JSON.stringify({ type: 'assign_id', id: clientId }));

  // Notificar a ambos lados si ya hay dos clientes
  if (clients.length === 2) {
    clients.forEach((client) => {
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

      clients.forEach((client) => {
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
    const closedClient = clients.find(client => client.socket === ws);
    if (closedClient) {
      clients = clients.filter(client => client.socket !== ws);
      console.log(`Cliente #${closedClient.id} se ha desconectado.`);

      // Notificar al peer que el otro se desconectó
      clients.forEach((client) => {
        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.send(JSON.stringify({ type: 'peer_disconnected' }));
        }
      });
    }
  });
});

// 5. Iniciar el servidor
server.listen(port, () => {
  console.log(`Servidor iniciado en el puerto ${port}`);
});