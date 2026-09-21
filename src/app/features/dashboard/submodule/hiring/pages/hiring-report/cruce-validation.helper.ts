import { PreviewSchema, PreviewIssue, PreviewField, PreviewOption } from 'src/app/shared/model/validation-preview';

export interface CruceRow {
    _id: string; // row-N
    rowIndex: number;
    raw: string[];

    // Mapped fields
    contrato: string;       // 0
    cedula: string;         // 1
    tem: string;            // 2
    tipoDoc: string;        // 5
    fechaIngreso: string;   // 8
    nit: string;            // 11
    nombre1: string;        // 12
    nombre2: string;        // 13
    apellido1: string;      // 14
    apellido2: string;      // 15
    nombres: string;        // Combined
    fechaNac: string;       // 16
    estadoCivil: string;    // 18
    celular: string;        // 21
    fechaExp: string;       // 24
    rh: string;             // 29
    zurdo: string;          // 30
    escolaridad: string;    // 37
    nivelTecnico: string;   // 38
    nivelTecnologo: string; // 39
    nivelUniv: string;      // 40
    nivelEsp: string;       // 41
    anioFin: string;        // 44

    familiarNombre: string;     // 50
    familiarParentesco: string; // 51
    familiarCelular: string;    // 52
    familiarDireccion: string;  // 53

    email: string; // Dynamic
}

export class CruceValidationHelper {

    static COL_CONTRATO = 3;
    static COL_CEDULA = 1;
    static COL_TEM = 2;
    static COL_TIPODOC = 5;
    static COL_FECHA_INGRESO = 8;
    static COL_NIT = 11;

    static COL_FECHA_NAC = 16;
    static COL_ESTADO_CIVIL = 18;
    static COL_FECHA_EXP = 24;
    static COL_RH = 29;
    static COL_ZURDO = 30;
    static COL_ESCOLARIDAD = 37;
    static COL_ANIO_FIN = 44;

    // 38-41 Niveles
    // 50-55 Familiar (Mandatory)

    static EMAIL_DOMAINS_WHITELIST = [
        'GMAIL.COM', 'HOTMAIL.COM', 'YAHOO.COM', 'ICLOUD.COM', 'OUTLOOK.COM',
        'OUTLOOK.ES', 'MAIL.COM', 'YAHOO.COM.CO', 'UNICARTAGENA.EDU.CO',
        'CUN.EDU.CO', 'MISENA.EDU.CO', 'UNIGUAJIRA.EDU.CO', 'UNILLANOS.EDU.CO',
        'UCUNDINAMARCA.EDU.CO', 'UNCUNDINAMARCA.EDU.CO', 'USANTOTOMAS.EDU.CO',
        'UNAL.EDU.CO', 'UNICAUCA.EDU.CO', 'UNIMILITAR.EDU.CO', 'HOTMAIL.COM.CO',
        'HOTMAIL.COM.AR', 'LASVILLAS.EMAIL', 'YAHOO.ES'
    ];

    static parseRows(rawRows: string[][], headerRow: string[]): CruceRow[] {
        let emailIdx = headerRow.findIndex(h => h && (h.toString().toUpperCase().includes('CORREO') || h.toString().toUpperCase().includes('EMAIL')));

        return rawRows.map((row, idx) => {
            const get = (i: number) => (row[i] || '').toString().trim();
            // Sanitize TipoDoc (Col 5) removing special chars
            const getTipoDoc = () => get(this.COL_TIPODOC).replace(/[^a-zA-Z0-9]/g, '');

            return {
                _id: `row-${idx}`,
                rowIndex: idx + 2,
                raw: row,
                contrato: get(this.COL_CONTRATO),
                cedula: get(this.COL_CEDULA),
                tem: get(this.COL_TEM),
                tipoDoc: getTipoDoc(),
                fechaIngreso: get(this.COL_FECHA_INGRESO),
                nit: get(this.COL_NIT),
                nombre1: get(12),
                nombre2: get(13),
                apellido1: get(14),
                apellido2: get(15),
                nombres: [get(12), get(13), get(14), get(15)].filter(Boolean).join(' '),
                fechaNac: get(this.COL_FECHA_NAC),
                estadoCivil: get(this.COL_ESTADO_CIVIL),
                celular: get(21),
                fechaExp: get(this.COL_FECHA_EXP),
                rh: get(this.COL_RH),
                zurdo: get(this.COL_ZURDO),
                escolaridad: get(this.COL_ESCOLARIDAD),
                nivelTecnico: get(38),
                nivelTecnologo: get(39),
                nivelUniv: get(40),
                nivelEsp: get(41),
                anioFin: get(this.COL_ANIO_FIN),
                familiarNombre: get(50),
                familiarParentesco: get(51),
                familiarCelular: get(52),
                familiarDireccion: get(53),
                email: emailIdx >= 0 ? get(emailIdx) : ''
            };
        });
    }

    static getSchema(headerRow: string[], uploadedRef?: { cedulas: string[], traslados: string[] }): PreviewSchema<CruceRow> {
        const emailIdx = headerRow.findIndex(h => h && (h.toString().toUpperCase().includes('CORREO') || h.toString().toUpperCase().includes('EMAIL')));

        return {
            title: 'Validación de Cruce Diario',
            subtitle: 'Se encontraron errores en el archivo. Por favor corríjalos antes de continuar.',
            itemId: (item) => item._id,

            columns: [
                { key: 'rowIndex', header: 'Fila', width: '50px', cell: (i) => i.rowIndex },
                { key: 'cedula', header: 'Cédula', cell: (i) => i.cedula },
                { key: 'nombres', header: 'Nombres', cell: (i) => i.nombres },
                { key: 'tem', header: 'TEM', width: '60px', cell: (i) => i.tem },
                { key: 'fechaIngreso', header: 'F. Ingreso', cell: (i) => i.fechaIngreso },
                { key: 'rh', header: 'RH', width: '50px', cell: (i) => i.rh },
            ],

            editFields: [
                {
                    key: 'cedula', label: 'Cédula (Col 1)', type: 'text', required: true,
                    onChange: (i) => i.raw[this.COL_CEDULA] = i.cedula
                },
                {
                    key: 'nit', label: 'NIT (Col 11)', type: 'text', required: true,
                    onChange: (i) => i.raw[this.COL_NIT] = i.nit
                },
                {
                    key: 'tipoDoc', label: 'Tipo Doc (Col 5)', type: 'select',
                    options: [{ value: 'CC', label: 'CC' }, { value: 'CE', label: 'CE' }, { value: 'P.P.T', label: 'P.P.T' }, { value: 'TI', label: 'TI' }, { value: 'PEP', label: 'PEP' }],
                    onChange: (i) => i.raw[this.COL_TIPODOC] = i.tipoDoc
                },
                {
                    key: 'tem', label: 'TEM (Col 2)', type: 'select',
                    options: [{ value: 'AL', label: 'AL' }, { value: 'TA', label: 'TA' }],
                    onChange: (i) => i.raw[this.COL_TEM] = i.tem
                },
                {
                    key: 'fechaIngreso', label: 'F. Ingreso (Col 8)', type: 'text', hint: 'DD/MM/YYYY',
                    onChange: (i) => i.raw[this.COL_FECHA_INGRESO] = i.fechaIngreso
                },
                {
                    key: 'fechaNac', label: 'F. Nacimiento (Col 16)', type: 'text', hint: 'DD/MM/YYYY',
                    onChange: (i) => i.raw[this.COL_FECHA_NAC] = i.fechaNac
                },
                {
                    key: 'estadoCivil', label: 'Estado Civil (Col 18)', type: 'select',
                    options: ['SO', 'UL', 'CA', 'SE', 'VI'].map(v => ({ value: v, label: v })),
                    onChange: (i) => i.raw[this.COL_ESTADO_CIVIL] = i.estadoCivil
                },
                {
                    key: 'celular', label: 'Celular (Col 21)', type: 'text', required: true,
                    onChange: (i) => i.raw[21] = i.celular
                },
                {
                    key: 'rh', label: 'RH (Col 29)', type: 'select',
                    options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(v => ({ value: v, label: v })),
                    onChange: (i) => i.raw[this.COL_RH] = i.rh
                },
                {
                    key: 'escolaridad', label: 'Escolaridad (Col 37)', type: 'text',
                    onChange: (i) => i.raw[this.COL_ESCOLARIDAD] = i.escolaridad
                },
                {
                    key: 'email', label: 'Correo', type: 'text',
                    visible: () => emailIdx >= 0,
                    onChange: (i) => { if (emailIdx >= 0) i.raw[emailIdx] = i.email; }
                }
            ],

            // B. Validaciones por fila (Pre-calcula el año actual para mayor velocidad O(n))
            validateItem: (item) => this.validateRow(item, new Date().getFullYear()),

            // A & C. Validaciones por lote / consistencia
            validateAll: (items) => this.validateBatch(items, uploadedRef),

            buildResult: (items) => items.map(i => i.raw)
        };
    }

    /**
     * B. VALIDACIONES POR FILA
     */
    static validateRow(item: CruceRow, currentYear: number): PreviewIssue[] {
        const issues: PreviewIssue[] = [];
        const addError = (msg: string, field?: string) => {
            // console.debug REMOVED FOR PERFORMANCE
            issues.push({ id: `row-${item._id}-${field || 'gen'}`, itemId: item._id, severity: 'error', message: msg, field });
        };

        // Fecha Ingreso
        if (!item.fechaIngreso || item.fechaIngreso.includes('-') || !this.isValidDate(item.fechaIngreso)) {
            addError(`Fecha Ingreso inválida (Col 8). Valor: '${item.fechaIngreso}'. Requiere DD/MM/YYYY sin guiones.`, 'fechaIngreso');
        }

        // TEM
        if (!['AL', 'TA'].includes(item.tem)) {
            addError(`TEM inválido (Col 2). Valor: '${item.tem}'. Permitidos: AL, TA.`, 'tem');
        }

        // Estado Civil
        if (!['SO', 'UL', 'CA', 'SE', 'VI'].includes(item.estadoCivil)) {
            addError(`Estado Civil inválido (Col 18). Valor: '${item.estadoCivil}'. Permitidos: SO, UL, CA, SE, VI.`, 'estadoCivil');
        }

        // Celular (Col 21)
        if (item.celular) {
            if (!/^\d+$/.test(item.celular)) {
                addError(`Teléfono móvil inválido (Col 21). Valor: '${item.celular}'. Solo debe contener números.`, 'celular');
            }
        } else {
            addError(`El Teléfono móvil (Col 21) es obligatorio.`, 'celular');
        }

        // RH
        if (!['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].includes(item.rh)) {
            addError(`RH inválido (Col 29). Valor: '${item.rh}'.`, 'rh');
        }

        // Zurdo/Diestro
        const manos = ['ZURDO', 'DIESTRO', 'AMBIDIESTRO'];
        if (!item.zurdo || !manos.some(m => item.zurdo.toUpperCase().includes(m))) {
            addError(`Zurdo/Diestro inválido (Col 30). Valor: '${item.zurdo}'.`, 'zurdo');
        }

        // Escolaridad
        if (item.escolaridad !== '-') {
            const n = Number(item.escolaridad);
            if (isNaN(n) || n < 1 || n > 11) {
                addError(`Escolaridad inválida (Col 37). Valor: '${item.escolaridad}'. Debe ser '-' o 1-11.`, 'escolaridad');
            }
        }

        // Niveles (38-41)
        [item.nivelTecnico, item.nivelTecnologo, item.nivelUniv, item.nivelEsp].forEach((val, i) => {
            const v = (val || '').trim().toLowerCase();
            if (v && v !== '-' && v !== 'x') {
                addError(`Nivel Educativo inválido (Col ${38 + i}). Valor: '${val}'. Solo permite vacío, '-' o 'x'.`, 'nivelTecnico');
            }
        });

        // Año Fin
        if (item.anioFin && item.anioFin !== '-') {
            const y = this.parseYear(item.anioFin);
            if (!y || y > currentYear) addError(`Año de finalización inválido (Col 44). Valor: '${item.anioFin}'.`, 'anioFin');
        }

        // Familiar (50-55)
        const famRequired = [item.raw[50], item.raw[51], item.raw[52], item.raw[53], item.raw[54], item.raw[55]];
        if (famRequired.some(x => !x || x.toString().trim() === '')) {
            addError('Datos de familiar de emergencia incompletos (Cols 50-55). Todos son obligatorios.', 'familiarNombre');
        }

        // Nombres sin dígitos
        if (/\d/.test(item.nombres)) {
            addError('Nombres/apellidos contienen dígitos.', 'nombres');
        }

        // Fechas y Edad
        // Nacimiento
        if (!this.isValidDate(item.fechaNac) || item.fechaNac.includes('-')) {
            addError('Fecha Nacimiento inválida o con "-".', 'fechaNac');
        } else {
            const age = this.calculateAge(item.fechaNac);
            if (age < 18) addError(`Menor de edad (${age} años).`, 'fechaNac');
        }

        // Expedición
        if (item.tipoDoc !== 'P.P.T' && item.tipoDoc !== 'PPT') {
            if (!item.fechaExp || item.fechaExp === '-' || !this.isValidDate(item.fechaExp)) {
                addError('Fecha Expedición obligatoria y válida para este documento.', 'fechaExp');
            } else {
                const ageExp = this.calculateAgeAt(item.fechaNac, item.fechaExp);
                if (ageExp < 17) addError(`Edad en expedición inválida (${ageExp} años). Mínimo 17.`, 'fechaExp');
            }
        }

        // Intra-fila PPT vs X
        const ced = (item.cedula || '').toUpperCase();
        if ((item.tipoDoc === 'P.P.T' || item.tipoDoc === 'PPT') && !ced.startsWith('X')) {
            addError('Documento P.P.T requiere Cédula iniciando con "X".', 'cedula');
        }
        if (ced.startsWith('X') && item.tipoDoc !== 'P.P.T' && item.tipoDoc !== 'PPT') {
            addError('Cédula inicia con "X", Tipo Doc debe ser P.P.T.', 'tipoDoc');
        }

        // CC vs NIT
        if (item.cedula !== item.nit) {
            addError(`Cédula (Col 1: ${item.cedula}) no coincide con NIT (Col 11: ${item.nit}).`, 'nit');
        }

        // Email
        if (item.email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(item.email)) {
                addError('Formato de correo inválido.', 'email');
            } else {
                const domain = item.email.split('@')[1]?.toUpperCase();
                if (!this.EMAIL_DOMAINS_WHITELIST.some(d => domain === d)) {
                    addError(`Dominio no permitido: ${domain}.`, 'email');
                }
            }
        }

        return issues;
    }

    /**
     * A & C. VALIDACIONES POR LOTE / CONSISTENCIA
     */
    static validateBatch(items: CruceRow[], uploadedRef?: { cedulas: string[], traslados: string[] }): PreviewIssue[] {
        const issues: PreviewIssue[] = [];

        // A. CONSISTENCIA (Archivos vs Excel)
        if (uploadedRef) {
            const excelCedulas = new Set(items.map(i => i.cedula.trim()));
            const pdfCedulas = new Set(uploadedRef.cedulas.map(c => c.trim()));

            // A1. Excel vs PDFs (1:1)
            // Faltan en Excel (Están en PDF pero no en Excel)
            const missingInExcel = [...pdfCedulas].filter(x => !excelCedulas.has(x));
            if (missingInExcel.length > 0) {
                const sample = missingInExcel.slice(0, 5).join(', ');
                const more = missingInExcel.length > 5 ? ` (+${missingInExcel.length - 5} más)` : '';
                const msg = `Inconsistencia: ${missingInExcel.length} cédulas subidas no están en el Excel (Cols 1). [${sample}${more}]`;
                issues.push({
                    id: 'global-missing-excel',
                    itemId: 'GLOBAL',
                    severity: 'error',
                    message: msg,
                    field: 'cedula'
                });
            }

            // Sobran en Excel (Están en Excel pero no en PDF)
            items.forEach(item => {
                const c = item.cedula.trim();
                if (!pdfCedulas.has(c)) {
                    issues.push({
                        id: `consist-extra-${item._id}`,
                        itemId: item._id,
                        severity: 'error',
                        message: 'Cédula en Excel no tiene archivo PDF correspondiente subido.',
                        field: 'cedula',
                        resolutionAction: 'upload-pdf'
                    });
                }
            });

            // A2. Traslados
            const trasladosCedulas = new Set(uploadedRef.traslados.map(c => c.trim()));
            const trasladosMissing = [...trasladosCedulas].filter(x => !excelCedulas.has(x));
            if (trasladosMissing.length > 0) {
                const sample = trasladosMissing.slice(0, 5).join(', ');
                const more = trasladosMissing.length > 5 ? ` (+${trasladosMissing.length - 5} más)` : '';
                const msg = `Inconsistencia Traslados: ${trasladosMissing.length} traslados no están en el Excel. [${sample}${more}]`;
                issues.push({
                    id: 'global-missing-traslado',
                    itemId: 'GLOBAL',
                    severity: 'error',
                    message: msg,
                    field: 'traslados'
                });
            }
        }

        // C. BATCH INTERNO
        const mapContratos = new Map<string, string[]>(); // key -> itemIds[]
        const mapCorreos = new Map<string, string[]>();   // email -> itemIds[] 
        const mapCelulares = new Map<string, string[]>(); // celular -> itemIds[]

        items.forEach(it => {
            // Contrato duplicado
            const keyDesc = `${it.contrato}-${it.tem}`;
            if (!mapContratos.has(keyDesc)) mapContratos.set(keyDesc, []);
            mapContratos.get(keyDesc)?.push(it._id);

            // Correo duplicado
            if (it.email) {
                const e = it.email.toUpperCase();
                if (!mapCorreos.has(e)) mapCorreos.set(e, []);
                mapCorreos.get(e)?.push(it._id);
            }

            // Celular duplicado
            if (it.celular) {
                const c = it.celular.trim();
                if (!mapCelulares.has(c)) mapCelulares.set(c, []);
                mapCelulares.get(c)?.push(it._id);
            }
        });

        // Generar issues contrato
        mapContratos.forEach((ids, key) => {
            if (ids.length > 1) {
                const [contrato, tem] = key.split('-');
                ids.forEach(id => {
                    const msg = `Código de contrato duplicado en el archivo para la temporal ${tem} (${contrato}).`;
                    issues.push({
                        id: `batch-contrato-${id}`,
                        itemId: id,
                        severity: 'error',
                        message: msg,
                        field: 'contrato'
                    });
                });
            }
        });

        // Generar issues celular
        mapCelulares.forEach((ids, celular) => {
            if (ids.length > 1) {
                const cedulasInvolved = new Set<string>();
                ids.forEach(id => {
                    const row = items.find(r => r._id === id);
                    if (row) cedulasInvolved.add(row.cedula.trim());
                });

                if (cedulasInvolved.size > 1) {
                    ids.forEach(id => {
                        const msg = `Teléfono móvil (${celular}) repetido en el archivo para cédulas distintas.`;
                        issues.push({
                            id: `batch-celular-${id}`,
                            itemId: id,
                            severity: 'error',
                            message: msg,
                            field: 'celular'
                        });
                    });
                }
            }
        });

        // Generar issues correo
        mapCorreos.forEach((ids, email) => {
            if (ids.length > 1) {
                const cedulasInvolved = new Set<string>();
                ids.forEach(id => {
                    const row = items.find(r => r._id === id);
                    if (row) cedulasInvolved.add(row.cedula.trim());
                });

                if (cedulasInvolved.size > 1) {
                    ids.forEach(id => {
                        const msg = `Correo repetido para cédulas distintas: ${email}`;
                        issues.push({
                            id: `batch-email-${id}`,
                            itemId: id,
                            severity: 'error',
                            message: msg,
                            field: 'email'
                        });
                    });
                }
            }
        });

        return issues;
    }

    // UTILS
    static isValidDate(d: string): boolean {
        if (!d || d.length < 8) return false;
        const regex = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
        if (!regex.test(d)) return false;
        const parts = d.split('/');
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        if (month < 1 || month > 12) return false;
        if (day < 1) return false;
        // Validate days per month
        const daysInMonth = new Date(year, month, 0).getDate();
        if (day > daysInMonth) return false;
        return true;
    }

    static parseDate(d: string): Date | null {
        if (!this.isValidDate(d)) return null;
        const parts = d.split('/');
        return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }

    static parseYear(y: string): number | null {
        if (!y) return null;
        if (y.length === 4 && !isNaN(Number(y))) return Number(y);
        if (this.isValidDate(y)) return this.parseDate(y)?.getFullYear() || null;
        return null;
    }

    static calculateAge(dateStr: string): number {
        const dob = this.parseDate(dateStr);
        if (!dob) return 0;
        const diff = Date.now() - dob.getTime();
        const ageDt = new Date(diff);
        return Math.abs(ageDt.getUTCFullYear() - 1970);
    }

    static calculateAgeAt(birthStr: string, atDateStr: string): number {
        const dob = this.parseDate(birthStr);
        const at = this.parseDate(atDateStr);
        if (!dob || !at) return 0;
        let age = at.getFullYear() - dob.getFullYear();
        const m = at.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && at.getDate() < dob.getDate())) age--;
        return age;
    }
}
