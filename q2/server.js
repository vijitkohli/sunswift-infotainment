import app from './app.js';

// Separate from app.js so tests can exercise the app without binding a port.
const port = process.env.PORT ?? 3000;

app.listen(port, () => {
  console.log(`Telemetry API listening on http://localhost:${port}`);
});
