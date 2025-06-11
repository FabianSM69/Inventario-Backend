import bcrypt from 'bcryptjs';

const saltRounds = 10;

const password = "123456"; // Contraseña en texto plano
bcrypt.hash(password, saltRounds, (err, hash) => {
  if (err) throw err;
  console.log("Contraseña encriptada:", hash);
  // Guarda el hash en la base de datos
});