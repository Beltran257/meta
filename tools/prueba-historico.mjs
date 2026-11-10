/* PRUEBA DEL HISTÓRICO PARA SALUD — sin red. Comprueba la hora de la primera
   clase de cada día (worker/historico.js), que Salud usa para calcular a qué
   hora acostarse. Uso:  node tools/prueba-historico.mjs */
import { historicoSalud } from '../worker/historico.js';

let fallos = 0;
const mal = m => { console.log('❌ ' + m); fallos++; };
const bien = m => console.log('✅ ' + m);

const buzon = { claves: { horario: { datos: {
  franjas: [{ ini: '08:15', fin: '09:10' }, { ini: '09:10', fin: '10:05' }, { ini: '11:00', fin: '11:55' }],
  dias: { lunes: [false, true, true], martes: [true, true, false], miercoles: [false, false, false] },
} } } };
// 2026-11-09 lunes, 2026-11-10 martes, 2026-11-11 miércoles, 2026-11-14 sábado
const h = historicoSalud(buzon, ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-14']);
if (h['2026-11-09'].primera_clase !== '09:10') mal(`lunes: primera clase ${h['2026-11-09'].primera_clase}, debía ser 09:10`); else bien('lunes: la primera franja ocupada, no la primera del horario');
if (h['2026-11-10'].primera_clase !== '08:15') mal(`martes: ${h['2026-11-10'].primera_clase}`); else bien('martes: 08:15');
if (h['2026-11-11'].primera_clase !== null) mal('un día sin clases debe dar null'); else bien('sin clases: null');
if (h['2026-11-14'].primera_clase !== null) mal('el sábado debe dar null'); else bien('fin de semana: null');
if (historicoSalud({}, ['2026-11-09'])['2026-11-09'].primera_clase !== null) mal('sin horario debe dar null'); else bien('sin horario: null');

console.log(fallos ? `\n${fallos} fallos` : '\n0 fallos');
process.exit(fallos ? 1 : 0);
