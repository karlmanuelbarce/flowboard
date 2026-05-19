// src/server.ts
import app from './app';
 
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Notes API running at http://localhost:${PORT}`);
});