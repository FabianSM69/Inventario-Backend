import db from '../config/db.js';

class User {
  static async findByUsername(username) {
    const [rows] = await db.query('SELECT * FROM usuarios WHERE username = ?', [username]);
    return rows[0];
  }
}

export default User;