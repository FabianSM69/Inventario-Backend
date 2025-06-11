import dotenv from "dotenv";
import express from "express";
import { Pool } from "pg";
import cors from "cors";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";

dotenv.config();
const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cors());

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  },
  tls: { rejectUnauthorized: false },
});

app.post('/send-email', (req, res) => {
  const { name, email, message } = req.body;
  const mailOptions = {
    from: email,
    to: 'invsupp12@gmail.com',
    subject: 'Nuevo mensaje de soporte',
    text: `De: ${name} <${email}>\n\nMensaje:\n\n${message}`,
  };

  transporter.sendMail(mailOptions, (err) => {
    if (err) return res.status(500).json({ error: 'Error al enviar el correo' });
    res.status(200).json({ message: 'Correo enviado exitosamente' });
  });
});

app.post('/register', async (req, res) => {
  const { username, password, role = "user" } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    await db.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
      [username, hashedPassword, role]
    );
    res.json({ message: 'Usuario registrado exitosamente!' });
  } catch (err) {
    res.status(500).json({ error: 'Error registrando usuario' });
  }
});
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Contraseña incorrecta' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      "tu_secreto_jwt",
      { expiresIn: "1h" }
    );

    res.json({ message: 'Inicio de sesión exitoso!', token, role: user.role });
  } catch (err) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

app.get('/getproductos', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM productos');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Error al obtener los productos' });
  }
});

app.put('/modifyproduct', async (req, res) => {
  const { id, cantidad_total, precio_unitario } = req.body;

  if (!id || cantidad_total === undefined || precio_unitario === undefined) {
    return res.status(400).json({ error: 'Faltan parámetros necesarios' });
  }

  try {
    await db.query(
      'UPDATE productos SET cantidad_total = $1, precio_unitario = $2 WHERE id = $3',
      [cantidad_total, precio_unitario, id]
    );

    const actividad = `Producto con ID ${id} modificado con nueva cantidad ${cantidad_total} y precio ${precio_unitario}`;
    const fecha = new Date();

    await db.query(
      'INSERT INTO historial_actividad (fecha, usuario, accion, detalles) VALUES ($1, $2, $3, $4)',
      [fecha, 'Admin', 'Modificación', actividad]
    );

    res.json({ message: 'Producto modificado exitosamente' });
  } catch {
    res.status(500).json({ error: 'Error al modificar el producto' });
  }
});

app.delete('/deleteproduct/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('DELETE FROM productos WHERE id = $1', [id]);

    const actividad = `Producto con ID ${id} eliminado`;
    const fecha = new Date();

    await db.query(
      'INSERT INTO historial_actividad (fecha, usuario, accion, detalles) VALUES ($1, $2, $3, $4)',
      [fecha, 'Admin', 'Eliminación', actividad]
    );

    res.json({ message: 'Producto eliminado exitosamente' });
  } catch {
    res.status(500).json({ error: 'Error al eliminar el producto' });
  }
});
app.post('/registerproduct', async (req, res) => {
  const { nombre, cantidad_entrada, cantidad_devuelta_cliente, precio_unitario, imagen } = req.body;

  if (!nombre || !cantidad_entrada || !precio_unitario) {
    return res.status(400).json({ error: 'Todos los campos obligatorios deben completarse' });
  }

  const cantidad_total = cantidad_entrada;
  const precio_total = cantidad_total * precio_unitario;
  const fecha_registro = new Date();

  try {
    await db.query(`
      INSERT INTO productos 
      (nombre, cantidad_entrada, cantidad_total, cantidad_devuelta_cliente, precio_unitario, precio_total, imagen, fecha_registro) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [nombre, cantidad_entrada, cantidad_total, cantidad_devuelta_cliente || 0, precio_unitario, precio_total, imagen, fecha_registro]);

    const actividad = `Producto '${nombre}' registrado con ${cantidad_entrada} unidades a $${precio_unitario}`;
    await db.query(
      'INSERT INTO historial_actividad (fecha, usuario, accion, detalles) VALUES ($1, $2, $3, $4)',
      [fecha_registro, 'Admin', 'Registro', actividad]
    );

    res.json({ message: 'Producto registrado exitosamente' });
  } catch (err) {
    console.error("❌ Error al registrar producto:", err);
    res.status(500).json({ error: 'Error al registrar el producto en la base de datos' });
  }
});

app.put('/updateproduct/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { precio_unitario, cantidad_total, cantidad_devuelta_cliente, precio_total, imagen } = req.body;

  if (isNaN(id) || precio_unitario === undefined || cantidad_total === undefined || precio_total === undefined) {
    return res.status(400).json({ error: 'Datos inválidos o incompletos' });
  }

  try {
    const result = await db.query(`
      UPDATE productos SET 
        precio_unitario = $1, 
        cantidad_total = $2, 
        cantidad_devuelta_cliente = $3, 
        precio_total = $4,
        imagen = $5
      WHERE id = $6
    `, [precio_unitario, cantidad_total, cantidad_devuelta_cliente || 0, precio_total, imagen, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const actividad = `Producto con ID ${id} actualizado (precio_unitario=${precio_unitario}, cantidad_total=${cantidad_total}, devueltos=${cantidad_devuelta_cliente}, precio_total=${precio_total})`;
    const fecha = new Date();

    await db.query(
      'INSERT INTO historial_actividad (fecha, usuario, accion, detalles) VALUES ($1, $2, $3, $4)',
      [fecha, 'Admin', 'Modificación', actividad]
    );

    res.json({ message: '✅ Producto actualizado exitosamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar el producto' });
  }
});

app.post('/registersalida', async (req, res) => {
  const {
    id, unidades_vendidas = 0, unidades_devueltas = 0, motivo_devolucion = '',
    merma = 0, motivo_merma = '', precio_venta = 0
  } = req.body;

  if (!id) return res.status(400).json({ error: 'ID del producto es obligatorio' });

  try {
    const result = await db.query('SELECT * FROM productos WHERE id = $1', [id]);
    const producto = result.rows[0];
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const cantidad_total = producto.cantidad_total - unidades_vendidas - unidades_devueltas - merma;
    const precio_total = cantidad_total * producto.precio_unitario;

    await db.query(`
      UPDATE productos SET 
        unidades_vendidas = unidades_vendidas + $1,
        unidades_devueltas = unidades_devueltas + $2,
        motivo_devolucion = $3,
        merma = merma + $4,
        motivo_merma = $5,
        precio_venta = $6,
        cantidad_total = $7,
        precio_total = $8
      WHERE id = $9
    `, [
      unidades_vendidas,
      unidades_devueltas,
      motivo_devolucion,
      merma,
      motivo_merma,
      precio_venta,
      cantidad_total,
      precio_total,
      id
    ]);

    const actividad = `Salida registrada para producto ID ${id}:\n- Vendidas: ${unidades_vendidas}\n- Devueltas: ${unidades_devueltas}\n- Mermadas: ${merma}`;
    const fecha = new Date();

    await db.query('INSERT INTO historial_actividad (fecha, usuario, accion, detalles) VALUES ($1, $2, $3, $4)', [fecha, 'Admin', 'Salida', actividad]);

    res.json({ message: 'Salida registrada exitosamente' });
  } catch {
    res.status(500).json({ error: 'Error al registrar la salida' });
  }
});
app.get('/get-activity-history', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM historial_actividad ORDER BY fecha DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el historial' });
  }
});

app.get("/", (req, res) => {
  res.send("Servidor funcionando...");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
