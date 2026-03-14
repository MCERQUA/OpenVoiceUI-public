module.exports = {
  daemon: true,
  run: [
    // Start containers in foreground (Pinokio daemon mode manages lifecycle)
    {
      method: "shell.run",
      params: {
        message: "docker compose -f docker-compose.yml -f docker-compose.pinokio.yml up",
        on: [{
          event: "/Listening on.*\\d+|Running on http|Uvicorn running on/i",
          done: true,
        }],
      },
    },

    // Set URL so pinokio.js shows "Open" button
    {
      method: "local.set",
      params: {
        url: "http://localhost:5001",
      },
    },
  ],
}
