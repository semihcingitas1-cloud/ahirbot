// Yerelde çalıştırmak için: npm run dev
const app = require('./app');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`AhırBot API http://localhost:${PORT}`));
