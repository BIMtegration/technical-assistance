// 1. Importar las librerías
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

// 2. Configuración inicial
const port = process.env.PORT || 3000; // Render usará una variable, nosotros usamos 3000
const MAX_TEXT_LENGTH = 1000;

const app = express();
const server = http.createServer(app);

// Servir archivos estáticos desde /public
app.use(express.static(path.join(__dirname, 'public')));

// Ruta HTTP raíz — devuelve la UI del chat
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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