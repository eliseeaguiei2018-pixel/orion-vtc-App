import { hashPassword } from '../src/modules/admin/auth.js';

/**
 * Génère une entrée ADMIN_USERS (mot de passe HACHÉ) pour la console ORION.
 *
 *   npm run hash-password -- <username> <password> [role]
 *
 * role : super_admin | ops | finance | support | viewer  (défaut : super_admin)
 * Copiez l'objet JSON affiché dans la variable d'environnement ADMIN_USERS
 * (tableau JSON). Ne stockez jamais le mot de passe en clair.
 */
const [, , username, password, role = 'super_admin'] = process.argv;

if (!username || !password) {
  // eslint-disable-next-line no-console
  console.error('Usage : npm run hash-password -- <username> <password> [role]');
  process.exit(1);
}

const { salt, hash } = hashPassword(password);
const entry = { username, name: username, role, salt, hash };

// eslint-disable-next-line no-console
console.log('Ajoutez cet objet au tableau JSON ADMIN_USERS :\n');
// eslint-disable-next-line no-console
console.log(JSON.stringify(entry, null, 2));
// eslint-disable-next-line no-console
console.log('\nExemple : ADMIN_USERS=\'[' + JSON.stringify(entry) + ']\'');
