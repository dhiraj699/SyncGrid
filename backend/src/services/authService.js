import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { HttpError } from '../transport/http/httpError.js';

export const toPublicUser = ({ id, name, email, role, color, initials }) => ({ id, name, email, role, color, initials });

export class AuthService {
  constructor({ store, config }) {
    this.store = store;
    this.config = config;
  }

  async login(email, password) {
    const user = await this.store.findUserByEmail(email.toLowerCase());
    const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !passwordMatches) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

    const token = jwt.sign({ role: user.role }, this.config.JWT_SECRET, { subject: user.id, expiresIn: this.config.JWT_TTL });
    return { token, user: toPublicUser(user) };
  }

  /** Verifies the token and re-reads the user so role changes take effect on the next connection. */
  async authenticate(token) {
    if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Missing credentials');
    let payload;
    try {
      payload = jwt.verify(token, this.config.JWT_SECRET);
    } catch {
      throw new HttpError(401, 'INVALID_TOKEN', 'Session expired or invalid');
    }
    const user = await this.store.findUserById(payload.sub);
    if (!user) throw new HttpError(401, 'INVALID_TOKEN', 'Account no longer exists');
    return toPublicUser(user);
  }
}
