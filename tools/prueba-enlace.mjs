/* ===========================================================================
   PRUEBA DEL ENLACE DE CARPETA — sin red ni iCloud. Un PDF que iCloud había
   dejado solo en la nube fallaba al leerse desde el LaunchAgent con
   "Unknown system error -11" en cada pasada, y nunca llegaba a Meta. Se
   prueba que ese error se reconoce (y solo ese) y que entonces se le pide a
   iCloud el archivo con brctl.

   Uso:  node tools/prueba-enlace.mjs
   =========================================================================== */
process.env.META_ENLACE_PRUEBA = '1';
const { soloEnICloud, pideAICloud } = await import('./enlace-carpeta.mjs');

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);

// El error tal cual lo dio node en registro.log (errno -11, sin código con nombre).
const deICloud = Object.assign(new Error('Unknown system error -11: Unknown system error -11, read'),
  { errno: -11, code: 'Unknown system error -11', syscall: 'read' });
soloEnICloud(deICloud) ? bien('el error -11 de iCloud se reconoce') : mal('el error -11 de iCloud no se reconoce');

const noExiste = Object.assign(new Error("ENOENT: no such file or directory, open 'x.pdf'"), { errno: -2, code: 'ENOENT' });
!soloEnICloud(noExiste) ? bien('un archivo que no existe no se confunde con iCloud') : mal('ENOENT se toma por iCloud');
!soloEnICloud(new Error('HTTP 413')) ? bien('un fallo del servidor no se confunde con iCloud') : mal('un 413 se toma por iCloud');

const llamadas = [];
const ejecutaBien = (cmd, args, cb) => { llamadas.push([cmd, ...args]); cb(null); };
const ok = await pideAICloud('/Users/x/Desktop/ /2º BACHILLERATO/Filo/tema 3.pdf', ejecutaBien);
ok && JSON.stringify(llamadas[0]) === JSON.stringify(['/usr/bin/brctl', 'download', '/Users/x/Desktop/ /2º BACHILLERATO/Filo/tema 3.pdf'])
  ? bien('se pide a iCloud con brctl download y la ruta entera, espacios incluidos')
  : mal(`llamada a brctl: ${JSON.stringify(llamadas)}`);

const falla = await pideAICloud('/x.pdf', (cmd, args, cb) => cb(new Error('brctl: not permitted')));
falla === false ? bien('si brctl falla se sabe, no se da por pedido') : mal('un brctl fallido se da por bueno');

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
