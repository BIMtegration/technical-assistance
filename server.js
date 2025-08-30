// 1. Importar las librerías
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

// 2. Configuración inicial
const port = process.env.PORT || 3000; // Render usará una variable, nosotros usamos 3000
const app = express();
const server = http.createServer(app);

// 3. Crear el servidor de WebSockets
const wss = new WebSocket.Server({ server });

// 4. La Lógica del Chat
let clients = [];

wss.on('connection', (ws) => {
  // --- A. CUANDO ALGUIEN NUEVO SE CONECTA ---
  if (clients.length >= 2) {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  const clientId = clients.length + 1;
  clients.push({ id: clientId, socket: ws });
  console.log(`Cliente #${clientId} conectado.`);
  ws.send(JSON.stringify({ type: 'assign_id', id: clientId }));

  // --- B. CUANDO RECIBIMOS UN MENSAJE ---
  ws.on('message', (message) => {
    const parsedMessage = JSON.parse(message);
    clients.forEach((client) => {
      if (client.id !== parsedMessage.id && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(JSON.stringify({
          type: 'chat_message',
          id: parsedMessage.id,
          text: parsedMessage.text
        }));
      }
    });
  });

  // --- C. CUANDO ALGUIEN SE DESCONECTA ---
  ws.on('close', () => {
    const closedClient = clients.find(client => client.socket === ws);
    if (closedClient) {
      clients = clients.filter(client => client.socket !== ws);
      console.log(`Cliente #${closedClient.id} se ha desconectado.`);
    }
  });
});

// 5. Iniciar el servidor
server.listen(port, () => {
  console.log(`Servidor iniciado en el puerto ${port}`);
});