

## 📦 mediasoup-nest-backend

A backend WebRTC signaling server using **NestJS**, **Socket.IO**, and **mediasoup**.

---

### 🔗 Git Clone

```bash
git clone https://github.com/amal-suresh/mediasoup-NestJS-backend.git
cd mediasoup-nest-backend
```

---

### 🛠️ Install Dependencies

```bash
npm install
```

---

### 🧱 Required System Dependencies (for mediasoup)

Install these on your system (for Ubuntu/Debian):

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  python3 \
  libssl-dev \
  libsrtp2-dev \
  libopus-dev \
  libvpx-dev \
  libwebrtc-audio-processing-dev \
  libusrsctp-dev
```

For macOS, use `brew`:

```bash
brew install libsrtp opus libvpx
```

---

### 🚀 Start the Server

```bash
npm run start:dev
```

The WebSocket server will run at:

```
ws://localhost:3000/mediasoup
```

---

### 📁 Project Structure

```
src/
├── app.module.ts
├── mediasoup/
│   ├── mediasoup.gateway.ts   ← WebSocket logic
│   ├── mediasoup.service.ts   ← Core mediasoup logic
│   └── mediasoup.module.ts
```

---

### 🔌 WebSocket Events

| Event Name                 | Description                          |
| -------------------------- | ------------------------------------ |
| `getRouterRtpCapabilities` | Request RTP Capabilities from server |
| `routerRtpCapabilities`    | Response with capabilities           |

You can add more events like:

* `createSendTransport`
* `connectTransport`
* `produce`
* `consume`

---

### 💡 Client Socket Example

```js
const socket = io('http://localhost:3000/mediasoup');

socket.emit('getRouterRtpCapabilities');

socket.on('routerRtpCapabilities', (caps) => {
  console.log('RTP Capabilities', caps);
});
```

---

### 🧪 Test

You can use any WebRTC client (React, plain JS) to test with `mediasoup-client`.

---

### 📄 License

MIT

