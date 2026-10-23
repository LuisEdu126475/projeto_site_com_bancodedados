import crypto from 'node:crypto';
import { promisify } from 'node:util';
import env from '../config/env.js';
import { HttpError } from './httpError.js';

const scryptRaw = promisify(crypto.scrypt);

/**
 * Fila do scrypt: cada cálculo usa ~128 MB de RAM (N=2^17). Sem limite, uma
 * rajada de logins simultâneos derrubaria uma VPS pequena por falta de memória.
 * No máximo 2 cálculos rodam ao mesmo tempo; os demais esperam na fila e, se
 * a fila lotar, a requisição recebe 503 ("servidor ocupado") em vez de travar.
 */
export const HASH_CONCURRENCY = 2;
export const HASH_QUEUE_LIMIT = 32;
let activeHashes = 0;
const hashQueue = [];

function acquireHashSlot() {
  if (activeHashes < HASH_CONCURRENCY) {
    activeHashes++;
    return Promise.resolve();
  }
  if (hashQueue.length >= HASH_QUEUE_LIMIT) {
    return Promise.reject(
      new HttpError(503, 'Muitos acessos ao mesmo tempo. Tente novamente em alguns segundos.', { code: 'BUSY' }),
    );
  }
  return new Promise((resolve) => hashQueue.push(resolve));
}

function releaseHashSlot() {
  const next = hashQueue.shift();
  if (next) next(); // a vaga passa direto para o próximo da fila
  else activeHashes--;
}

async function scrypt(...args) {
  await acquireHashSlot();
  try {
    return await scryptRaw(...args);
  } finally {
    releaseHashSlot();
  }
}

/** Estado da fila (usado nos testes automatizados). */
export const hashQueueStats = () => ({ active: activeHashes, waiting: hashQueue.length });

/**
 * Hash de senhas com scrypt (nativo do Node, sem dependências).
 * Parâmetros alinhados às recomendações da OWASP: N=2^17, r=8, p=1.
 * Formato armazenado: scrypt$N$r$p$salt$hash (base64url).
 */
// Em testes automatizados o custo é reduzido apenas para acelerar a suíte.
const SCRYPT = { N: env.isTest ? 2 ** 12 : 2 ** 17, r: 8, p: 1, keyLen: 64 };
const maxmem = 256 * 1024 * 1024;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keyLen } = SCRYPT;
  const hash = await scrypt(password.normalize('NFKC'), salt, keyLen, { N, r, p, maxmem });
  return ['scrypt', N, r, p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Hash pré-calculado usado para equalizar o tempo de resposta de logins com e-mail inexistente. */
let dummyHash;
export async function getDummyHash() {
  dummyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

/** Token aleatório criptograficamente seguro (256 bits). */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Comparação em tempo constante para strings. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Anonimiza o IP com HMAC: permite detectar abuso (mesmo IP repetido)
 * sem armazenar o dado pessoal em claro (minimização exigida pela LGPD).
 */
export function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHmac('sha256', env.IP_HASH_SECRET).update(ip).digest('hex').slice(0, 32);
}

/** Código público de reserva, sem caracteres ambíguos (0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function reservationCode(length = 8) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}
