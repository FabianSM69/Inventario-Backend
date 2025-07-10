// server.js
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

// --- Helpers ---
async function logActividad(usuario, accion, detalles) {
  const fecha = new Date();
  await db.query(
    'INSERT INTO historial_actividad (fecha, usuario, accion, detalles) VALUES ($1, $2, $3, $4)',
    [fecha, usuario, accion, detalles]
  );
}

// --- Rutas de soporte/email ---
app.post('/send-email', (req, res) => {
  const { name, email, message } = req.body;
  const mailOptions = {
    from: process.env.GMAIL_USER,
    replyTo: email,
    to: 'invsupp12@gmail.com',
    subject: 'Nuevo mensaje de soporte',
    text: `De: ${name} <${email}>\n\nMensaje:\n\n${message}`,
  };
  transporter.sendMail(mailOptions, err => {
    if (err) return res.status(500).json({ error: 'Error al enviar el correo' });
    res.json({ message: 'Correo enviado exitosamente' });
  });
});

// --- Autenticación ---
app.post('/register', async (req, res) => {
  const { username, password, role = "user" } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  try {
    await db.query('INSERT INTO users (username,password,role) VALUES($1,$2,$3)', [username, hashed, role]);
    res.json({ message: 'Usuario registrado exitosamente!' });
  } catch {
    res.status(500).json({ error: 'Error registrando usuario' });
  }
});
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await db.query('SELECT * FROM users WHERE username=$1', [username]);
    if (!rows[0]) return res.status(401).json({ error: 'Usuario no encontrado' });
    const ok = await bcrypt.compare(password, rows[0].password);
    if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });
    const token = jwt.sign({ id: rows[0].id, role: rows[0].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ message: 'Inicio de sesión exitoso!', token, role: rows[0].role });
  } catch {
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// --- Productos ---
app.get('/getproductos', async (_, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM productos ORDER BY id');
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});
app.post('/registerproduct', async (req, res) => {
  const { nombre, cantidad_entrada, cantidad_devuelta_cliente = 0, precio_unitario, imagen } = req.body;
  if (!nombre || !cantidad_entrada || !precio_unitario) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  const cantidad_total = cantidad_entrada;
  const precio_total = cantidad_total * precio_unitario;
  const fecha_registro = new Date();
  try {
    await db.query(`
      INSERT INTO productos
      (nombre,cantidad_entrada,cantidad_total,cantidad_devuelta_cliente,precio_unitario,precio_total,imagen,fecha_registro)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    `, [nombre, cantidad_entrada, cantidad_total, cantidad_devuelta_cliente, precio_unitario, precio_total, imagen, fecha_registro]);
    await logActividad('Admin','Registro', `Producto '${nombre}' con ${cantidad_entrada}u a $${precio_unitario}`);
    res.json({ message: 'Producto registrado exitosamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar producto' });
  }
});
app.put('/modifyproduct', async (req, res) => {
  const { id, cantidad_total, precio_unitario } = req.body;
  if (!id || cantidad_total == null || precio_unitario == null) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }
  try {
    await db.query('UPDATE productos SET cantidad_total=$1,precio_unitario=$2 WHERE id=$3',
      [cantidad_total, precio_unitario, id]);
    await logActividad('Admin','Modificación', `ID${id} cantidad=${cantidad_total} precio=${precio_unitario}`);
    res.json({ message: 'Producto modificado exitosamente' });
  } catch {
    res.status(500).json({ error: 'Error al modificar producto' });
  }
});
app.put('/updateproduct/:id', async (req, res) => {
  const id = +req.params.id;
  const { precio_unitario, cantidad_total, cantidad_devuelta_cliente = 0, precio_total, imagen } = req.body;
  if (isNaN(id) || precio_unitario == null || cantidad_total == null || precio_total == null) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }
  try {
    const { rowCount } = await db.query(`
      UPDATE productos SET 
        precio_unitario=$1,
        cantidad_total=$2,
        cantidad_devuelta_cliente=$3,
        precio_total=$4,
        imagen=$5
      WHERE id=$6
    `, [precio_unitario, cantidad_total, cantidad_devuelta_cliente, precio_total, imagen, id]);
    if (!rowCount) return res.status(404).json({ error: 'Producto no existe' });
    await logActividad('Admin','Modificación', `ID${id} PU=${precio_unitario} CT=${cantidad_total} CD=${cantidad_devuelta_cliente} PT=${precio_total}`);
    res.json({ message: 'Producto actualizado exitosamente' });
  } catch {
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});
app.delete('/deleteproduct/:id', async (req, res) => {
  const id = +req.params.id;
  try {
    await db.query('DELETE FROM productos WHERE id=$1', [id]);
    await logActividad('Admin','Eliminación', `ID${id}`);
    res.json({ message: 'Producto eliminado exitosamente' });
  } catch {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// --- Códigos de barras ---
app.put('/asignar-codigo/:id', async (req, res) => {
  const id = +req.params.id;
  const { codigo_barras } = req.body;
  if (!codigo_barras) return res.status(400).json({ error: 'Código obligatorio' });
  try {
    await db.query('UPDATE productos SET codigo_barras=$1 WHERE id=$2', [codigo_barras, id]);
    res.json({ message: 'Código asignado correctamente' });
  } catch {
    res.status(500).json({ error: 'Error al asignar código' });
  }
});
app.get('/productos-sin-codigo', async (_, res) => {
  try {
    const { rows } = await db.query('SELECT id,nombre FROM productos WHERE codigo_barras IS NULL');
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Error al obtener sin código' });
  }
});

// --- Conteo físico desde app móvil ---
app.post('/registrar-conteo', async (req, res) => {
  const { codigo_barras } = req.body;
  if (!codigo_barras) return res.status(400).json({ error: 'Código obligatorio' });
  try {
    const prod = (await db.query('SELECT id,nombre FROM productos WHERE codigo_barras=$1', [codigo_barras])).rows[0];
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });
    const exist = (await db.query(
      'SELECT id FROM conteo_inventario WHERE producto_id=$1', [prod.id]
    )).rowCount;
    if (exist) {
      await db.query('UPDATE conteo_inventario SET cantidad_contada = cantidad_contada+1, fecha=CURRENT_TIMESTAMP WHERE producto_id=$1', [prod.id]);
    } else {
      await db.query('INSERT INTO conteo_inventario(producto_id,codigo_barras,nombre,cantidad_contada) VALUES($1,$2,$3,1)', [prod.id, codigo_barras, prod.nombre]);
    }
    res.json({ message: 'Conteo registrado exitosamente' });
  } catch {
    res.status(500).json({ error: 'Error al registrar conteo' });
  }
});
app.get('/getconteofisico', async (_, res) => {
  try {
    const { rows } = await db.query('SELECT producto_id,cantidad_contada FROM conteo_inventario');
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Error al obtener conteo físico' });
  }
});
app.delete('/reiniciar-conteo/:codigo_barras', async (req, res) => {
  const cb = req.params.codigo_barras;
  try {
    await db.query('DELETE FROM conteo_inventario WHERE codigo_barras=$1', [cb]);
    res.json({ message: 'Conteo reiniciado' });
  } catch {
    res.status(500).json({ error: 'Error al reiniciar conteo' });
  }
});

// --- Rutas de resumen e historial ---
app.get('/resumen-conteo', async (_, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.id,p.nombre,p.codigo_barras,
        p.cantidad_total AS registrada,
        COALESCE(ci.contada,0) AS contada,
        COALESCE(ci.contada,0)-p.cantidad_total AS diferencia,
        p.imagen
      FROM productos p
      LEFT JOIN (
        SELECT codigo_barras,SUM(cantidad_contada) contada
        FROM conteo_inventario GROUP BY codigo_barras
      ) ci ON p.codigo_barras=ci.codigo_barras
    `);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Error al obtener resumen' });
  }
});
app.get('/get-activity-history', async (_, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM historial_actividad ORDER BY fecha DESC');
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// --- Salidas simples (actualiza stock y registra en tabla salidas) ---
app.post('/registersalida', async (req, res) => {
  const {
    id, unidades_vendidas = 0, unidades_devueltas = 0,
    merma = 0, motivo_devolucion = '', motivo_merma = '',
    precio_venta = 0
  } = req.body;
  if (!id) return res.status(400).json({ error: 'ID obligatorio' });
  try {
    // 1) Insertar en salidas
    await db.query(`
      INSERT INTO salidas
      (producto_id,unidades_vendidas,unidades_devueltas,merma,precio_venta,motivo_devolucion,motivo_merma)
      VALUES($1,$2,$3,$4,$5,$6,$7)
    `, [id, unidades_vendidas, unidades_devueltas, merma, precio_venta, motivo_devolucion, motivo_merma]);

    // 2) Actualizar stock en productos
    const p = (await db.query('SELECT cantidad_total,precio_unitario FROM productos WHERE id=$1', [id])).rows[0];
    const nuevoTotal = p.cantidad_total - unidades_vendidas - unidades_devueltas - merma;
    const nuevoPrecioTotal = nuevoTotal * p.precio_unitario;
    await db.query(`
      UPDATE productos SET
        cantidad_total=$1, precio_total=$2,
        unidades_vendidas = unidades_vendidas + $3,
        unidades_devueltas = unidades_devueltas + $4,
        merma = merma + $5,
        precio_venta = precio_venta + $6
      WHERE id=$7
    `, [nuevoTotal, nuevoPrecioTotal, unidades_vendidas, unidades_devueltas, merma, precio_venta, id]);

    res.json({ message: 'Salida registrada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar salida' });
  }
});

// --- Estadísticas ---
app.get('/stats/masVendidos', async (_, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.id,p.nombre,SUM(s.unidades_vendidas) AS total_vendidas
      FROM salidas s
      JOIN productos p ON p.id=s.producto_id
      GROUP BY p.id,p.nombre
      ORDER BY total_vendidas DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Error al obtener más vendidos' });
  }
});

// --- FIFO de lotes (básico) ---
// Insertar lote
app.post('/lotes', async (req, res) => {
  const { producto_id, cantidad, costo_unitario, fecha_lote } = req.body;
  if (!producto_id || !cantidad || !costo_unitario) {
    return res.status(400).json({ error: 'Faltan datos de lote' });
  }
  try {
    await db.query(`
      INSERT INTO lotes
      (producto_id,cantidad,costo_unitario,fecha_lote)
      VALUES($1,$2,$3,$4)
    `, [producto_id, cantidad, costo_unitario, fecha_lote || new Date()]);
    res.json({ message: 'Lote registrado (FIFO)' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar lote' });
  }
});
app.put('/lotes/:id', async (req, res) => {
  const loteId = +req.params.id;
  const { cantidad, fecha_lote } = req.body;
  if (isNaN(loteId) || cantidad == null) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }
  try {
    // 1) Leer lote actual
    const { rows } = await db.query(
      'SELECT producto_id, cantidad AS cantidad_old FROM lotes WHERE id=$1',
      [loteId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lote no encontrado' });
    const { producto_id, cantidad_old } = rows[0];

    // 2) Actualizar lote
    await db.query(
      'UPDATE lotes SET cantidad=$1, fecha_lote=$2 WHERE id=$3',
      [cantidad, fecha_lote || new Date(), loteId]
    );

    // 3) Ajustar stock en productos (restar el viejo, sumar el nuevo)
    const delta = cantidad - cantidad_old;
    await db.query(
      `UPDATE productos
         SET cantidad_total = cantidad_total + $1,
             precio_total   = precio_unitario * (cantidad_total + $1)
       WHERE id = $2`,
      [delta, producto_id]
    );

    await logActividad('Admin', 'Ajuste de lote', `Lote ${loteId}: Δcantidad=${delta}`);
    res.json({ message: 'Lote actualizado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar lote' });
  }
});
// Salida FIFO
app.post('/salidas/fifo', async (req, res) => {
  const { producto_id, cantidad_salida } = req.body;
  if (!producto_id || !cantidad_salida) {
    return res.status(400).json({ error: 'Datos de salida obligatorios' });
  }
  try {
    let restante = cantidad_salida;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const lotes = (await client.query(`
        SELECT id,cantidad,costo_unitario
        FROM lotes
        WHERE producto_id=$1 AND cantidad>0
        ORDER BY fecha_lote ASC
      `, [producto_id])).rows;
      for (const lote of lotes) {
        if (restante <= 0) break;
        const usar = Math.min(restante, lote.cantidad);
        // registrar salida por lote
        await client.query(`
          INSERT INTO salidas_fifo (lote_id,producto_id,cantidad,costo_unitario,fecha)
          VALUES($1,$2,$3,$4,$5)
        `, [lote.id, producto_id, usar, lote.costo_unitario, new Date()]);
        // actualizar lote
        await client.query('UPDATE lotes SET cantidad = cantidad - $1 WHERE id=$2', [usar, lote.id]);
        restante -= usar;
      }
      await client.query('COMMIT');
      res.json({ message: 'Salida FIFO procesada', faltante: restante });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en salida FIFO' });
  }
});

// --- Salud ---
app.get("/", (_, res) => res.send("Servidor funcionando..."));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
