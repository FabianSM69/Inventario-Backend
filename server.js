    import dotenv from "dotenv";
    import express from "express";
    import mysql from "mysql2";
    import cors from "cors";
    import bcrypt from "bcryptjs";
    import nodemailer from "nodemailer";
    import jwt from "jsonwebtoken";

    dotenv.config();
    const app = express();
    app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
    app.use(cors());

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS
        },
        tls: {
            rejectUnauthorized: false,
        },
    });

    app.post('/send-email', (req, res) => {
        const { name, email, message } = req.body;

        const mailOptions = {
            from: email,
            to: 'invsupp12@gmail.com',
            subject: 'Nuevo mensaje de soporte',
            text: `De: ${name} <${email}>\n\nMensaje:\n\n${message}`,
        };

        transporter.sendMail(mailOptions, (err, info) => {
            if (err) {
                console.error('Error al enviar el correo:', err);
                return res.status(500).json({ error: 'Error al enviar el correo' });
            }
            res.status(200).json({ message: 'Correo enviado exitosamente' });
        });
    });

    const db = mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    db.connect(err => {
        if (err) {
            console.error('Error conectando a la base de datos:', err);
            return;
        }
        console.log('Conectado a MySQL!');
    });

    app.post('/register', async (req, res) => {
        const { username, password, role = "user" } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        db.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, role], (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Error registrando usuario' });
            }
            res.json({ message: 'Usuario registrado exitosamente!' });
        });
    });

    app.post('/login', (req, res) => {
        const { username, password } = req.body;

        db.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
            if (err) return res.status(500).json({ error: 'Error en el servidor' });
            if (results.length === 0) return res.status(401).json({ error: 'Usuario no encontrado' });

            const user = results[0];
            const isMatch = await bcrypt.compare(password, user.password);

            if (!isMatch) return res.status(401).json({ error: 'Contraseña incorrecta' });

            const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, "tu_secreto_jwt", { expiresIn: "1h" });

            res.json({ message: 'Inicio de sesión exitoso!', token, role: user.role });
        });
    });

    app.get('/getproductos', (req, res) => {
        db.query('SELECT * FROM productos', (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Error al obtener los productos' });
            }
            res.json(results);
        });
    });

    app.put('/modifyproduct', (req, res) => {
        const { id, cantidad_total, precio_unitario } = req.body;

        if (!id || cantidad_total === undefined || precio_unitario === undefined) {
            return res.status(400).json({ error: 'Faltan parámetros necesarios' });
        }

        db.query('UPDATE productos SET cantidad_total = ?, precio_unitario = ? WHERE id = ?', [cantidad_total, precio_unitario, id], (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Error al modificar el producto' });
            }

            const actividad = `Producto con ID ${id} modificado con nueva cantidad ${cantidad_total} y precio ${precio_unitario}`;
            const fecha = new Date();
            db.query('INSERT INTO historial_actividad (fecha, usuario, accion, detalles) VALUES (?, ?, ?, ?)', [fecha, 'Admin', 'Modificación', actividad]);

            res.json({ message: 'Producto modificado exitosamente' });
        });
    });

    app.delete('/deleteproduct/:id', (req, res) => {
        const { id } = req.params;

        db.query('DELETE FROM productos WHERE id = ?', [id], (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Error al eliminar el producto' });
            }

            const actividad = `Producto con ID ${id} eliminado`;
            const fecha = new Date();
            db.query('INSERT INTO historial_actividad (fecha, usuario, accion, detalles) VALUES (?, ?, ?, ?)', [fecha, 'Admin', 'Eliminación', actividad]);

            res.json({ message: 'Producto eliminado exitosamente' });
        });
    });

    app.post('/registerproduct', (req, res) => {
    const { nombre, cantidad_entrada, cantidad_devuelta_cliente, precio_unitario, imagen } = req.body;

    // Validación básica
    if (!nombre || !cantidad_entrada || !precio_unitario) {
        return res.status(400).json({ error: 'Todos los campos obligatorios deben completarse' });
    }

    const cantidad_total = cantidad_entrada;
    const precio_total = cantidad_total * precio_unitario;
    const fecha_registro = new Date();

    db.query(`
        INSERT INTO productos 
        (nombre, cantidad_entrada, cantidad_total, cantidad_devuelta_cliente, precio_unitario, precio_total, imagen, fecha_registro) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [nombre, cantidad_entrada, cantidad_total, cantidad_devuelta_cliente || 0, precio_unitario, precio_total, imagen, fecha_registro], (err, result) => {
        if (err) {
            console.error("❌ Error al registrar producto:", err);
            return res.status(500).json({ error: 'Error al registrar el producto en la base de datos' });
        }

        const actividad = `Producto '${nombre}' registrado con ${cantidad_entrada} unidades a $${precio_unitario}`;
        db.query(
            'INSERT INTO historial_actividad (fecha, usuario, accion, detalles) VALUES (?, ?, ?, ?)',
            [fecha_registro, 'Admin', 'Registro', actividad]
        );

        res.json({ message: 'Producto registrado exitosamente' });
    });
});


    app.put('/updateproduct/:id', (req, res) => {
        const id = parseInt(req.params.id);

        console.log("🛠️ Actualizando producto con ID:", id);

        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const { precio_unitario, cantidad_total, cantidad_devuelta_cliente, precio_total, imagen } = req.body;

        // Validar datos esenciales
        if (
            precio_unitario === undefined ||
            cantidad_total === undefined ||
            precio_total === undefined
        ) {
            return res.status(400).json({ error: 'Faltan datos obligatorios para actualizar el producto' });
        }

        const query = `
            UPDATE productos SET 
                precio_unitario = ?, 
                cantidad_total = ?, 
                cantidad_devuelta_cliente = ?, 
                precio_total = ?,
                imagen = ?
            WHERE id = ?
        `;

        db.query(
            query,
            [precio_unitario, cantidad_total, cantidad_devuelta_cliente || 0, precio_total, imagen, id],
            (err, result) => {
                if (err) {
                    console.error('❌ Error en la base de datos:', err);
                    return res.status(500).json({ error: 'Error al actualizar el producto' });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({ error: 'Producto no encontrado' });
                }

                const actividad = `Producto con ID ${id} actualizado (precio_unitario=${precio_unitario}, cantidad_total=${cantidad_total}, devueltos=${cantidad_devuelta_cliente}, precio_total=${precio_total})`;
                const fecha = new Date();

                db.query(
                    'INSERT INTO historial_actividad (fecha, usuario, accion, detalles) VALUES (?, ?, ?, ?)',
                    [fecha, 'Admin', 'Modificación', actividad]
                );

                res.json({ message: '✅ Producto actualizado exitosamente' });
            }
        );
    });

    app.post('/registersalida', (req, res) => {
        const {
            id, unidades_vendidas = 0, unidades_devueltas = 0, motivo_devolucion = '',
            merma = 0, motivo_merma = '', precio_venta = 0
        } = req.body;

        if (!id) return res.status(400).json({ error: 'ID del producto es obligatorio' });

        db.query('SELECT * FROM productos WHERE id = ?', [id], (err, results) => {
            if (err || results.length === 0) return res.status(500).json({ error: 'Producto no encontrado' });

            const producto = results[0];
            const cantidad_total = producto.cantidad_total - unidades_vendidas - unidades_devueltas - merma;
            const precio_total = cantidad_total * producto.precio_unitario;

            db.query(`
                UPDATE productos SET 
                    unidades_vendidas = unidades_vendidas + ?,
                    unidades_devueltas = unidades_devueltas + ?,
                    motivo_devolucion = ?,
                    merma = merma + ?,
                    motivo_merma = ?,
                    precio_venta = ?,
                    cantidad_total = ?,
                    precio_total = ?
                WHERE id = ?
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
            ], (err, result) => {
                if (err) return res.status(500).json({ error: 'Error al registrar la salida' });

                const actividad = `Salida registrada para producto ID ${id}:
                    - Vendidas: ${unidades_vendidas}
                    - Devueltas: ${unidades_devueltas}
                    - Mermadas: ${merma}`;

                const fecha = new Date();
                db.query('INSERT INTO historial_actividad (fecha, usuario, accion, detalles) VALUES (?, ?, ?, ?)',
                    [fecha, 'Admin', 'Salida', actividad]);

                res.json({ message: 'Salida registrada exitosamente' });
            });
        });
    });

    app.get('/get-activity-history', (req, res) => {
        db.query('SELECT * FROM historial_actividad ORDER BY fecha DESC', (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Error al obtener el historial' });
            }
            res.json(results);
        });
    });

    app.get("/", (req, res) => {
        res.send("Servidor funcionando...");
    });

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
