const app = require('./src/app');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
  🚀 DB-Git Backend Server
  📡 Listening on http://localhost:${PORT}
  🛠️  MVC & Services structure active
  `);
});

// Keep process alive
setInterval(() => { }, 1000 * 60 * 60); // 1 hour interval
