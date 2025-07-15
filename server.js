// server.js
console.log("🔥 server.js arrancado");
import dotenv from "dotenv";
import express from "express";
import { Pool } from "pg";
import cors from "cors";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import multer from 'multer';
const upload = multer({ dest: 'uploads/' });

dotenv.config();
const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cors());
app.use('/uploads', express.static('uploads'));

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
  // Desestructuramos todos los campos que ahora esperamos
  const { username, email, ownerName, phone, password, role = "user" } = req.body;

  // Validaciones básicas (puedes extenderlas)
  if (!username || !email || !ownerName || !phone || !password) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  try {
    // Hasheamos la contraseña
    const hashed = await bcrypt.hash(password, 10);

    // Insertamos con los nuevos campos
    await db.query(
      `INSERT INTO users
         (username, email, owner_name, phone, password, role)
       VALUES
         ($1,       $2,    $3,         $4,    $5,       $6)`,
      [username, email, ownerName, phone, hashed, role]
    );

    res.json({ message: 'Usuario registrado exitosamente!' });
  } catch (err) {
    console.error('REGISTER ERROR:', err);
    // Si es violación de UNIQUE(email) o username, podrías detectar código de error
    res.status(500).json({ error: 'Error registrando usuario' });
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
app.post('/login', async (req, res) => {
  const { login, password } = req.body;
  try {
    // Busca por username o por email
    const { rows } = await db.query(
      `SELECT * FROM users WHERE username = $1 OR email = $1`,
      [login]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    // Compara contraseña
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Contraseña incorrecta' });

    // Genera token
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Devuelve datos al cliente
    res.json({
      message: 'Inicio de sesión exitoso',
      token,
      role: user.role,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        ownerName: user.owner_name,
        phone: user.phone
      }
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: 'Error interno en login' });
  }
});

// --- Middleware de autenticación JWT ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token faltante' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.id;
    req.userRole = payload.role;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// --- Ruta para obtener datos del usuario logueado ---
app.get('/user/me', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT 
         id,
         username,
         email,
         owner_name  AS "ownerName",
         phone,
         role,
         photo_url   AS "photoUrl"
       FROM users
       WHERE id = $1`,
      [req.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('ERROR /user/me:', err);
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
});
app.get(
  '/admin/users',
  authenticateToken,
  requireRole('superadmin'),
  async (req, res) => {
    const { rows } = await db.query(
      'SELECT id, username, email, owner_name AS "ownerName", phone, role FROM users ORDER BY id'
    );
    res.json(rows);
  }
);

// Cambiar rol de un usuario
app.put(
  '/admin/users/:id/role',
  authenticateToken,
  requireRole('superadmin'),
  async (req, res) => {
    const userId = +req.params.id;
    const { role } = req.body;
    const validRoles = ['user','admin','superadmin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    await db.query('UPDATE users SET role=$1 WHERE id=$2', [role,userId]);
    res.json({ message: 'Rol actualizado' });
  }
);

// Eliminar usuario
app.delete(
  '/admin/users/:id',
  authenticateToken,
  requireRole('superadmin'),
  async (req, res) => {
    const userId = +req.params.id;
    await db.query('DELETE FROM users WHERE id=$1', [userId]);
    res.json({ message: 'Usuario eliminado' });
  }
);
export function requireRole(...allowed) {
  return (req, res, next) => {
    const role = req.userRole;            // lo guardas en authenticateToken
    if (!allowed.includes(role)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    next();
  };
}

// 1) Modifica tu REGISTER PRODUCT para devolver el id
app.post('/registerproduct', async (req, res) => {
  const { nombre, cantidad_entrada, cantidad_devuelta_cliente = 0, precio_unitario, imagen } = req.body;
  if (!nombre || !cantidad_entrada || !precio_unitario) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  const cantidad_total = cantidad_entrada;
  const precio_total = cantidad_total * precio_unitario;
  const fecha_registro = new Date();
  try {
    // PEDIMOS RETURNING id
    const result = await db.query(
      `INSERT INTO productos
         (nombre,cantidad_entrada,cantidad_total,cantidad_devuelta_cliente,precio_unitario,precio_total,imagen,fecha_registro)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [nombre, cantidad_entrada, cantidad_total, cantidad_devuelta_cliente, precio_unitario, precio_total, imagen, fecha_registro]
    );
    const newId = result.rows[0].id;
    await logActividad('Admin','Registro', `Producto '${nombre}' con ${cantidad_entrada}u a $${precio_unitario}`);
    // Respondemos el id para que el frontend lo coja
    res.json({ id: newId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar producto' });
  }
});

// 2) Nueva ruta GET /lotes para listar por producto_id
app.get('/lotes', async (req, res) => {
  const { producto_id } = req.query;
  if (!producto_id) {
    return res.status(400).json({ error: 'producto_id es obligatorio' });
  }
  try {
    const { rows } = await db.query(
      'SELECT id, cantidad, costo_unitario, fecha_lote FROM lotes WHERE producto_id = $1 ORDER BY fecha_lote ASC',
      [producto_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener lotes' });
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
// 1) Productos más vendidos este mes
app.get('/stats/ventas-mensuales', async (_, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.nombre,
             SUM(s.cantidad) AS total_vendidas
      FROM salidas_fifo s
      JOIN productos p    ON p.id = s.producto_id
      WHERE DATE_TRUNC('month', s.fecha_salida) = DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY p.nombre
      ORDER BY total_vendidas DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener ventas mensuales' });
  }
});
// 2) Entradas del día de hoy
app.get("/stats/entradas-hoy", async (_, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) AS total_entradas
      FROM lotes
      WHERE date(fecha_lote) = CURRENT_DATE
    `);
    // devolvemos un array para homogeneidad con Recharts
    res.json([{ total_entradas: parseInt(rows[0].total_entradas, 10) }]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener entradas de hoy" });
  }
});

// 3) Productos con stock más bajo
app.get("/stats/stock-bajo", async (_, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, nombre, cantidad_total
      FROM productos
      ORDER BY cantidad_total ASC
      LIMIT 10
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener stock bajo" });
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
      (producto_id, cantidad, cantidad_original, costo_unitario)
    VALUES($1, $2, $2, $3)
`, [producto_id, cantidad, costo_unitario]);
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
app.post("/salidas-fifo", async (req, res) => {
  const {
    producto_id, unidadesVendidas, unidadesDevueltas,
    merma, precioVenta, motivoDevolucion, motivoMerma
  } = req.body;

  // 1) Obtén los lotes de ese producto ordenados por fecha_lote ASC
  const lotes = await db.query(`
    SELECT * FROM lotes
      WHERE producto_id = $1
      ORDER BY fecha_lote
  `, [producto_id]);

  let qtyToRemove = unidadesVendidas + merma - unidadesDevueltas; 
    // o ajusta según lógica de devolución/merma

  // 2) Recorre los lotes y ve consumiendo stock de cada uno:
  for (const lote of lotes.rows) {
    if (qtyToRemove <= 0) break;

    const take = Math.min(qtyToRemove, lote.cantidad);
    qtyToRemove -= take;

    // a) Inserta la salida en salidas_fifo
    await db.query(`
      INSERT INTO salidas_fifo
        (lote_id, producto_id, cantidad, costo_unitario, tipo_salida, motivo, precio_venta)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      lote.id,
      producto_id,
      take,
      lote.costo_unitario,
      "venta",                // o 'devolucion' / 'merma' según el caso
      motivoDevolucion || motivoMerma,
      precioVenta
    ]);

    // b) Actualiza el lote descontándole esa cantidad
    await db.query(`
      UPDATE lotes SET cantidad = cantidad - $1 WHERE id = $2
    `, [take, lote.id]);
  }

  // 3) Finalmente actualiza el producto (stock total, etc.)
  await db.query(`
    UPDATE productos
      SET cantidad_total = cantidad_total - $1
      WHERE id = $2
  `, [unidadesVendidas - unidadesDevueltas + merma, producto_id]);

  res.json({ ok: true });
});

app.post(
  '/user/me/photo',
  authenticateToken,
  upload.single('profilePhoto'),
  async (req, res) => {
    // Aquí guardas el archivo y actualizas users.photo_url
    const filePath = `/uploads/${req.file.filename}`;
    await db.query(
      'UPDATE users SET photo_url=$1 WHERE id=$2',
      [filePath, req.userId]
    );
    res.json({ photoUrl: filePath });
  }
);
// --- Salud ---
app.get("/", (_, res) => res.send("Servidor funcionando..."));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
