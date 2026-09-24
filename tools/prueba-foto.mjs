/* ===========================================================================
   PRUEBA DE LA REDUCCIÓN DE FOTOS — sin red. Las fotos de apuntes subían tal
   cual (3-5 MB del iPhone) a un espacio de ~1 GB: unas 330 lo llenaban.

   Aquí se prueba el cálculo de medidas y que reducirFoto() nunca pierde la
   foto: si no puede abrirla, devuelve la original. El dibujo en el lienzo
   necesita un navegador y se comprobó en el de la app el 24 sep 2026: una
   foto de 4032×3024 hecha de ruido (el peor caso, 12 MB) pasó a 2000×1500 y
   1,2 MB; una imagen pequeña se quedó intacta y un HEIC ilegible se guardó
   tal cual.

   Uso:  node tools/prueba-foto.mjs
   =========================================================================== */
import { medidaReducida, reducirFoto, LADO_MAX } from '../app/js/core/archivos.js';

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Foto del iPhone en horizontal y en vertical: el lado largo queda en LADO_MAX.
igual(medidaReducida(4032, 3024), { ancho: LADO_MAX, alto: 1500, reducir: true })
  ? bien('4032×3024 → 2000×1500') : mal(`4032×3024 → ${JSON.stringify(medidaReducida(4032, 3024))}`);
igual(medidaReducida(3024, 4032), { ancho: 1500, alto: LADO_MAX, reducir: true })
  ? bien('3024×4032 → 1500×2000 (vertical)') : mal(`vertical → ${JSON.stringify(medidaReducida(3024, 4032))}`);

// Lo que ya cabe no se agranda ni se toca.
igual(medidaReducida(1200, 900), { ancho: 1200, alto: 900, reducir: false })
  ? bien('1200×900 se queda como está') : mal(`1200×900 → ${JSON.stringify(medidaReducida(1200, 900))}`);
igual(medidaReducida(LADO_MAX, 10), { ancho: LADO_MAX, alto: 10, reducir: false })
  ? bien('justo en el límite no se toca') : mal('el límite exacto se reduce');

// Sin navegador (ni Image ni canvas) tiene que devolver la original, no fallar.
const original = new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'image/jpeg' });
const r = await reducirFoto(original);
r === original ? bien('si no puede abrir la foto, guarda la original') : mal('reducirFoto perdió o cambió la foto al fallar');

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
