import express from 'express'; // Usar import en lugar de require
import bodyParser from 'body-parser';
import cors from 'cors';
import authRoutes from './routers/authRoutes.js'; // Asegúrate de incluir la extensión .js

// Crear la aplicación Express
const app = express();

// Middlewares
app.use(cors());
app.use(bodyParser.json());

// Rutas
app.use('/api/auth', authRoutes);

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('¡Bienvenido al sistema de inventario de abarrotes!');
});

// Exportar la aplicación
export default app; // Usar export default en lugar de module.exports