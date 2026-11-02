import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { Cipher } from '../config/constants.mjs';

const deriveKey = ({ dataKey, devPassphrase }) =>
  dataKey ? Buffer.from(dataKey, Cipher.ENCODING) : scryptSync(devPassphrase, Cipher.KDF_SALT, Cipher.KEY_BYTES);

const ENVELOPE_PREFIX = Cipher.ENVELOPE_VERSION + Cipher.ENVELOPE_SEPARATOR;

export class FieldCipher {
  #key;

  constructor(security) {
    this.#key = deriveKey(security);
    if (this.#key.length !== Cipher.KEY_BYTES) throw new RangeError(Cipher.ALGORITHM);
  }

  encrypt(plainText) {
    const iv = randomBytes(Cipher.IV_BYTES);
    const cipher = createCipheriv(Cipher.ALGORITHM, this.#key, iv);
    const data = Buffer.concat([cipher.update(String(plainText), Cipher.TEXT), cipher.final()]);
    return [Cipher.ENVELOPE_VERSION, iv, cipher.getAuthTag(), data]
      .map(part => (Buffer.isBuffer(part) ? part.toString(Cipher.ENCODING) : part))
      .join(Cipher.ENVELOPE_SEPARATOR);
  }

  decrypt(stored) {
    if (!this.isEncrypted(stored)) return stored;
    const [, iv, tag, data] = stored.split(Cipher.ENVELOPE_SEPARATOR).map(part => Buffer.from(part, Cipher.ENCODING));
    const decipher = createDecipheriv(Cipher.ALGORITHM, this.#key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(Cipher.TEXT);
  }

  isEncrypted(stored) {
    return typeof stored === 'string' && stored.startsWith(ENVELOPE_PREFIX);
  }
}
