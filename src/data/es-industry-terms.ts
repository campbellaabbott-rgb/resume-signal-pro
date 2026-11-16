// A COPY OF THE FREE SCANNER'S SPANISH INDUSTRY TERMS (S14X-214), so the
// /es/industrias pages print every Spanish term and title the engine knows.
//
// The engine merges these into INDUSTRY_KEYWORDS at load time, and the pages
// used to pick them back out with a guess (an accent, or a de/para/del/al
// word), which dropped every term the guess missed: of 222 terms and titles at
// most 103 were shown, and "litigios", "juzgado" and "contador" were on no
// page. The engine does not export its table (the cost heartbeat and the board
// wave own that file, and its _shared copy is a job-board import), so this is
// a copy; src/test/the-spanish-industry-pages-print-the-engines-terms.test.ts
// reads the block out of all three engine files and fails on any difference.
// Pure data, imported by the page and by the build-time prerenderer.

export const SPANISH_INDUSTRY_TERMS: Record<string, { primary: string[]; titles: string[] }> = {
  healthcare: {
    primary: ['enfermería', 'paciente', 'pacientes', 'atención médica', 'hospitalario', 'urgencias', 'quirófano', 'historia clínica', 'signos vitales', 'medicamentos', 'cuidados intensivos', 'consulta médica', 'diagnóstico', 'tratamiento médico'],
    titles: ['enfermera', 'enfermero', 'médico', 'médica', 'auxiliar de enfermería', 'fisioterapeuta', 'terapeuta ocupacional'],
  },
  technology: {
    primary: ['desarrollo de software', 'programación', 'aplicaciones web', 'base de datos', 'desarrollo web', 'sistemas informáticos', 'soporte técnico', 'infraestructura tecnológica'],
    titles: ['desarrollador', 'desarrolladora', 'programador', 'programadora', 'ingeniero de software', 'ingeniera de software', 'analista de sistemas'],
  },
  finance: {
    primary: ['contabilidad', 'estados financieros', 'presupuesto', 'auditoría', 'cuentas por pagar', 'cuentas por cobrar', 'conciliación bancaria', 'facturación', 'nómina', 'análisis financiero', 'tesorería', 'impuestos'],
    titles: ['contador', 'contadora', 'contable', 'analista financiero', 'auditor', 'auditora', 'tesorero'],
  },
  sales: {
    primary: ['ventas', 'cartera de clientes', 'cumplimiento de metas', 'prospección', 'cierre de ventas', 'atención al cliente', 'cuota de ventas', 'negociación comercial', 'punto de venta'],
    titles: ['vendedor', 'vendedora', 'ejecutivo de ventas', 'ejecutiva de ventas', 'asesor comercial', 'asesora comercial', 'gerente de ventas'],
  },
  education: {
    primary: ['docencia', 'plan de estudios', 'aula', 'alumnos', 'enseñanza', 'evaluación educativa', 'planificación de clases', 'educación primaria', 'educación secundaria'],
    titles: ['maestro', 'maestra', 'profesor', 'profesora', 'docente', 'educadora', 'director escolar'],
  },
  legal: {
    primary: ['derecho', 'litigios', 'contratos legales', 'asesoría jurídica', 'juzgado', 'demandas', 'expedientes legales', 'derecho laboral', 'derecho mercantil'],
    titles: ['abogado', 'abogada', 'asistente legal', 'asesor jurídico', 'notario'],
  },
  hospitality: {
    primary: ['hotelería', 'recepción de hotel', 'huéspedes', 'reservaciones', 'servicio al huésped', 'turismo', 'restaurante', 'banquetes'],
    titles: ['recepcionista', 'mesero', 'mesera', 'camarero', 'camarera', 'gerente de hotel', 'anfitrión'],
  },
  culinary: {
    primary: ['cocina profesional', 'preparación de alimentos', 'menú', 'repostería', 'panadería', 'higiene alimentaria', 'cocina caliente', 'cocina fría'],
    titles: ['cocinero', 'cocinera', 'chef ejecutivo', 'jefe de cocina', 'ayudante de cocina', 'repostero', 'panadero'],
  },
  logistics: {
    primary: ['logística', 'cadena de suministro', 'almacén', 'inventario', 'despacho', 'transporte de carga', 'distribución', 'montacargas', 'recepción de mercancía'],
    titles: ['almacenista', 'chofer', 'conductor', 'operador de montacargas', 'jefe de almacén', 'coordinador logístico'],
  },
  construction_management: {
    primary: ['obra civil', 'construcción', 'supervisión de obra', 'presupuesto de obra', 'planos', 'contratistas', 'seguridad en obra', 'edificación'],
    titles: ['maestro de obra', 'supervisor de obra', 'residente de obra', 'jefe de obra'],
  },
  skilled_trades: {
    primary: ['electricidad', 'plomería', 'fontanería', 'soldadura', 'mantenimiento industrial', 'instalaciones eléctricas', 'refrigeración', 'aire acondicionado'],
    titles: ['electricista', 'plomero', 'fontanero', 'soldador', 'soldadora', 'técnico de mantenimiento', 'mecánico'],
  },
  manufacturing: {
    primary: ['producción industrial', 'línea de producción', 'control de calidad', 'maquinaria industrial', 'planta de producción', 'ensamblaje', 'manufactura'],
    titles: ['operario', 'operaria', 'operador de producción', 'supervisor de producción', 'jefe de planta'],
  },
  hr: {
    primary: ['recursos humanos', 'reclutamiento', 'selección de personal', 'capacitación', 'relaciones laborales', 'nómina de personal', 'clima laboral', 'contratación'],
    titles: ['reclutador', 'reclutadora', 'generalista de recursos humanos', 'jefe de personal'],
  },
  administrative: {
    primary: ['asistencia administrativa', 'gestión de agenda', 'archivo de documentos', 'atención telefónica', 'oficina', 'redacción de documentos', 'apoyo administrativo'],
    titles: ['secretaria', 'secretario', 'asistente administrativo', 'asistente administrativa', 'auxiliar administrativo', 'recepcionista de oficina'],
  },
  retail: {
    primary: ['tienda', 'mostrador', 'caja registradora', 'exhibición de productos', 'atención en piso', 'venta minorista', 'inventario de tienda'],
    titles: ['cajero', 'cajera', 'dependiente', 'encargado de tienda', 'gerente de tienda'],
  },
};