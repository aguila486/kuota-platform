# Feature Specification: Platform Foundation

**Feature Branch**: `feature/001-platform-foundation`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "Platform Foundation (short name: platform-foundation). Fundación técnica del monorepo kuota-platform para que los equipos puedan construir las capacidades financieras de Kuota de forma segura, verificable y reproducible. SIN funcionalidades de negocio (sin usuarios, clientes, préstamos, ahorro ni pagos). [...] Fuera de alcance: identidad/autenticación (002), cualquier entidad de negocio, motores financieros, sincronización offline (011), aprovisionamiento cloud (D-ARC-04)."

> **Naturaleza de esta feature.** Es una capacidad de plataforma: sus "usuarios" son las personas y agentes que
> construyen Kuota (desarrolladores backend y móviles, revisores, responsable técnico, Claude Code) y quienes operan
> el sistema. El valor de negocio es indirecto pero crítico: cada feature financiera futura (002–015) heredará de
> esta fundación el aislamiento entre empresas, la precisión monetaria, la idempotencia, la auditoría y los quality
> gates exigidos por la Constitución. El stack tecnológico ya está fijado por la Constitución y los ADRs; esta
> especificación describe **qué** debe poder hacerse y verificarse, no cómo se implementa.

## Clarifications

### Session 2026-11-22

- Q: ¿Cómo se resuelve el SDK móvil incompatible (Dart 3.5.3 < 3.6) para el workspace móvil (D-ENV-01)? → A: Versión de Flutter fijada por proyecto con FVM; no se modifica la instalación global.
- Q: ¿Cuántas personas revisan Pull Requests al inicio? → A: Un único mantenedor; 1 aprobación humana + checklist constitucional + `/speckit-analyze` sin CRITICAL; la doble aprobación se activa con ≥ 2 mantenedores.
- Q: ¿Qué compilaciones de apps ejecuta CI en 001? → A: Android y Web en CI; iOS se compila localmente hasta que se requiera distribución.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Entorno local reproducible y ejecutable (Priority: P1)

Una persona desarrolladora nueva clona el repositorio, sigue una única guía de inicio y, con un solo comando
documentado, levanta los servicios locales (base de datos y servicio central). Puede comprobar que el servicio central
está vivo y listo, y ejecutar las pruebas de todos los componentes del monorepo con un único comando.

**Why this priority**: Sin un entorno reproducible, ninguna otra capacidad puede construirse ni verificarse. Es el
mínimo producto viable de la fundación.

**Independent Test**: En una máquina con las herramientas requeridas, seguir la guía de inicio desde un clon limpio y
verificar que el chequeo de salud responde "listo" y que la ejecución completa de pruebas termina en verde.

**Acceptance Scenarios**:

1. **Given** un clon limpio y las herramientas requeridas instaladas, **When** la persona ejecuta el comando de arranque
   documentado, **Then** la base de datos y el servicio central quedan en ejecución y el chequeo de disponibilidad
   indica "listo" en ≤ 15 minutos (arranque local; condiciones de medición en SC-001).
2. **Given** el entorno en ejecución, **When** se detiene la base de datos, **Then** el chequeo de disponibilidad indica
   "no listo" identificando la dependencia caída, mientras el chequeo de vida sigue indicando "vivo".
3. **Given** un clon limpio, **When** se revisa el repositorio, **Then** existe un archivo de ejemplo de variables de
   entorno con valores ficticios documentados y ningún secreto real versionado.
4. **Given** una versión de herramienta incompatible (p. ej. SDK móvil inferior al mínimo), **When** se ejecuta el
   arranque o la verificación de entorno, **Then** el proceso falla con un mensaje que indica la versión requerida.
5. **Given** el servicio central en ejecución y algunas solicitudes atendidas, **When** se consultan sus métricas
   técnicas, **Then** incluyen el conteo y la latencia de esas solicitudes por ruta y código de estado, el estado de las
   conexiones al almacén de datos y las métricas del proceso, sin datos personales ni identificadores de empresa.

---

### User Story 2 - Aislamiento entre empresas demostrable y reutilizable (Priority: P1)

El responsable técnico necesita evidencia de que los datos de una empresa (tenant) nunca son visibles ni modificables
desde otra, antes de que exista cualquier dato real. La fundación provee el mecanismo de contexto de empresa, el
aislamiento a nivel de almacén de datos y una suite de pruebas de acceso cruzado que cada feature futura reutiliza
para sus propios recursos.

**Why this priority**: El aislamiento multi-tenant es un principio NO NEGOCIABLE (Constitución III). Retrofitear
aislamiento después de tener datos de negocio es costoso y riesgoso.

**Independent Test**: Con un recurso técnico de demostración (no de negocio) creado para dos empresas, ejecutar la suite
de acceso cruzado y comprobar que cada empresa solo ve y modifica lo propio y que una consulta sin contexto no devuelve
datos.

**Acceptance Scenarios**:

1. **Given** registros técnicos de la empresa A y de la empresa B, **When** una solicitud en contexto de A pide un
   registro de B por su identificador, **Then** la respuesta es "no encontrado" (sin revelar su existencia).
2. **Given** registros de ambas empresas, **When** se consulta el almacén de datos sin contexto de empresa, **Then** se
   obtienen 0 registros.
3. **Given** el contexto de empresa A, **When** se intenta crear o modificar un registro indicando empresa B en los
   datos de la solicitud, **Then** la operación se rechaza o se asigna a A; nunca afecta a B.
4. **Given** el catálogo de estructuras de datos, **When** se ejecuta la verificación automática, **Then** toda
   estructura que contenga datos por empresa tiene el aislamiento habilitado y forzado; si alguna no lo tiene, la
   verificación falla nombrándola.
5. **Given** la cuenta con la que se conecta la aplicación, **When** se inspeccionan sus privilegios, **Then** no puede
   omitir el aislamiento ni alterar estructuras; los cambios de estructura usan una cuenta distinta.
6. **Given** dos solicitudes concurrentes de empresas distintas que comparten recursos de conexión, **When** se
   ejecutan intercaladas, **Then** ninguna observa datos ni contexto de la otra.

---

### User Story 3 - Quality gates automáticos en cada Pull Request (Priority: P1)

Un revisor abre un Pull Request y la integración continua le informa, sin intervención manual, si el cambio cumple las
reglas verificables de la Constitución. Solo se ejecutan las verificaciones de los componentes afectados por el
cambio, y cualquier gate bloqueante fallido impide la fusión.

**Why this priority**: Los principios constitucionales solo son reales si se verifican automáticamente; también
acota lo que Claude Code puede introducir sin ser detectado.

**Independent Test**: Abrir (localmente o en un entorno de prueba de CI) cambios intencionalmente defectuosos — un
secreto ficticio, un tipo flotante en código monetario, una estructura de datos sin aislamiento, un cambio
incompatible en el contrato, una dependencia prohibida del dominio hacia el framework — y verificar que cada uno es
bloqueado con un mensaje claro.

**Acceptance Scenarios**:

1. **Given** un cambio que solo afecta documentación, **When** corre CI, **Then** no se ejecutan las suites de backend
   ni móviles, y sí las verificaciones generales (secretos, formato).
2. **Given** un cambio en el servicio central, **When** corre CI, **Then** se ejecutan lint, tipos, pruebas unitarias e
   integración con base de datos real, cobertura, aislamiento multi-tenant y verificación de aislamiento de estructuras.
3. **Given** un cambio en el contrato de API, **When** corre CI, **Then** se valida el contrato, se detectan cambios
   incompatibles respecto a la rama principal y se verifica que el cliente móvil generado está actualizado.
4. **Given** un cambio que introduce un patrón de secreto, **When** corre CI, **Then** el gate de secretos falla.
5. **Given** un cambio que usa aritmética de punto flotante en código monetario, **When** corre CI, **Then** falla.
6. **Given** un cambio que hace que la capa de dominio dependa de framework, persistencia, red o UI, **When** corre CI,
   **Then** falla identificando la dependencia.
7. **Given** cobertura del dominio financiero por debajo del umbral constitucional, **When** corre CI, **Then** falla.
8. **Given** cualquier PR, **When** se abre, **Then** presenta la plantilla con el checklist de la Constitución y la
   referencia a spec/tareas, y los responsables de cada área quedan asignados automáticamente como revisores
   (verificación de la asignación pendiente hasta existir repositorio remoto e identificador GitHub válido; ver
   Assumptions).

---

### User Story 4 - Primitiva monetaria única y exacta (Priority: P2)

Quien desarrolle un motor financiero futuro dispone de una representación de dinero exacta (montos en unidades mínimas
con moneda explícita) y de aritmética decimal con redondeo explícito, idéntica en comportamiento en el servicio central
y en las apps, validada contra un conjunto compartido de casos numéricos de referencia.

**Why this priority**: Precisión financiera es NO NEGOCIABLE (Constitución IV); compartir fixtures evita que backend y
apps muestren cifras distintas. Es P2 porque no la consume ninguna capacidad hasta 004/005.

**Independent Test**: Ejecutar la suite de fixtures numéricos compartidos en ambos lados y comprobar resultados
idénticos al centavo.

**Acceptance Scenarios**:

1. **Given** los fixtures numéricos compartidos, **When** se ejecutan en el servicio central y en el paquete móvil,
   **Then** ambos producen exactamente los mismos resultados esperados.
2. **Given** dos montos de monedas distintas, **When** se intenta sumarlos, **Then** la operación se rechaza.
3. **Given** una operación que requiere redondeo, **When** no se especifica modo de redondeo, **Then** la operación no
   está permitida (el modo es obligatorio).
4. **Given** un monto recibido por la red, **When** se interpreta, **Then** se representa sin pérdida de precisión
   (incluyendo montos mayores que el rango exacto de números de punto flotante).
5. **Given** la división de un monto en N partes, **When** se reparte, **Then** la suma de las partes es exactamente
   el monto original.

---

### User Story 5 - Contrato de API como fuente de verdad (Priority: P2)

El equipo móvil consume el servicio central a través de un cliente generado a partir del contrato de API versionado.
El contrato inicial define las convenciones transversales (errores estándar, clave de idempotencia, representación de
dinero, chequeos de salud y compatibilidad) que todas las features futuras deben seguir.

**Why this priority**: Contract-first (Constitución XII) evita divergencia entre backend y tres apps.

**Independent Test**: Regenerar el cliente desde el contrato, compilar las tres apps con él, y verificar mediante
pruebas de contrato que las respuestas reales del servicio cumplen el contrato.

**Acceptance Scenarios**:

1. **Given** el contrato publicado en el repositorio, **When** se regenera el cliente móvil, **Then** el resultado es
   idéntico al versionado (sin cambios pendientes).
2. **Given** el servicio central en ejecución, **When** se ejecutan las pruebas de contrato, **Then** todas las
   respuestas (incluyendo errores) cumplen el esquema declarado.
3. **Given** una consulta de compatibilidad, **When** una app informa su versión, **Then** el servicio indica la versión
   de API vigente y la versión mínima soportada de cada app.
4. **Given** cualquier error, **When** el servicio responde, **Then** usa el formato estándar de errores con un
   identificador de correlación y sin datos sensibles.

---

### User Story 6 - Idempotencia y auditoría como bloques reutilizables (Priority: P2)

Quien implemente una operación que cambia estado (p. ej. registrar un pago en 007) puede declarar que es idempotente y
auditable reutilizando mecanismos de la fundación, en lugar de reinventarlos.

**Why this priority**: Constitución VI y VII. Su ausencia provoca duplicados financieros y falta de trazabilidad.

**Independent Test**: Sobre una operación técnica de demostración, enviar la misma solicitud repetidamente (secuencial y
concurrente) y verificar un único efecto y un único registro de auditoría por efecto.

**Acceptance Scenarios**:

1. **Given** una operación técnica con clave de idempotencia K, **When** se envía 10 veces con el mismo contenido
   (incluyendo 5 en paralelo), **Then** se produce un único efecto; las respuestas exitosas son equivalentes a la
   original (las reproducciones lo indican) y las que llegan mientras la primera está en proceso reciben 409 con
   `Retry-After`, y al reintentar obtienen la respuesta original.
2. **Given** la clave K ya usada, **When** se reenvía con contenido distinto, **Then** se rechaza con un error explícito
   de conflicto de idempotencia.
3. **Given** la misma clave K usada por dos empresas distintas, **When** ambas la envían, **Then** se tratan como
   operaciones independientes.
4. **Given** una operación de escritura exitosa, **When** se consulta la bitácora, **Then** existe un registro con
   actor, empresa, acción, entidad, fecha-hora del servidor y correlación.
5. **Given** un registro de auditoría existente, **When** cualquier cuenta de aplicación intenta modificarlo o borrarlo,
   **Then** la operación es rechazada.

---

### User Story 7 - Shells de aplicaciones y paquetes compartidos (Priority: P3)

El equipo móvil dispone de un workspace con las tres apps (administración web, cobradores, clientes) como esqueletos
ejecutables mínimos y los paquetes compartidos (núcleo, sistema de diseño, cliente de API, dominio financiero), con
dependencias resueltas una sola vez y comandos comunes para analizar y probar todo el workspace.

**Why this priority**: Habilita el trabajo móvil desde 002, pero ninguna app tiene funcionalidad todavía; depende de la
decisión D-ENV-01 (resuelta: SDK fijado por proyecto con FVM).

**Independent Test**: Ejecutar el análisis estático y las pruebas de todo el workspace móvil y lanzar cada app,
verificando que muestra su pantalla de inicio con el nombre de la app, el entorno y la versión.

**Acceptance Scenarios**:

1. **Given** el workspace móvil, **When** se resuelven dependencias, **Then** se resuelven una sola vez para todas las
   apps y paquetes, con versiones consistentes.
2. **Given** cada app, **When** se lanza en su plataforma objetivo, **Then** muestra una pantalla de inicio con nombre,
   entorno y versión, y puede consultar el chequeo de compatibilidad del servicio central.
3. **Given** el paquete de sistema de diseño, **When** una app lo usa, **Then** obtiene el tema común (incluyendo una
   variante de alto contraste reservada para recibos futuros).
4. **Given** una app, **When** intenta importar el código interno de otra app, **Then** la verificación de dependencias
   falla (solo pueden compartir vía paquetes).

---

### Edge Cases

- Puerto o servicio local ocupado al arrancar: el arranque falla con un mensaje accionable, no queda a medias.
- Migración de datos fallida a mitad: el estado queda consistente (la migración es atómica) y el arranque informa el
  error.
- Solicitud sin contexto de empresa a un recurso que lo requiere: se rechaza; nunca se ejecuta "sin filtro".
- Fuga de contexto entre solicitudes por reutilización de conexiones: cubierta por la prueba concurrente (US2-6).
- Clave de idempotencia con formato inválido o excesivamente larga: se rechaza con error de validación.
- Solicitud idéntica que llega mientras la primera aún se procesa: recibe 409 con `Retry-After`; nunca se produce un
  segundo efecto.
- Clave de idempotencia expirada (más de 30 días): se trata como nueva; el registro expirado no bloquea la operación.
- Monto con más decimales que la unidad mínima de la moneda: se rechaza en la frontera; no se redondea en silencio.
- Monto fuera del rango representable, en forma no canónica (ceros a la izquierda, `-0`) o en una moneda no soportada:
  se rechaza con un error explícito; nunca se trunca.
- Logs que reciben datos sensibles por error (teléfono, token, identificador fiscal): se redactan antes de emitirse.
- Cambio en el contrato que elimina un campo usado por apps desplegadas: CI lo detecta como incompatible.
- Herramientas locales con versión distinta a la fijada: la verificación de entorno lo advierte.
- CI sin acceso a un repositorio remoto todavía: los flujos se validan localmente (ver Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

**Entorno y estructura**

- **FR-001**: El repositorio MUST incluir una guía de inicio y un único comando documentado para levantar los servicios
  locales necesarios (almacén de datos y servicio central).
- **FR-002**: El repositorio MUST proveer un comando único que ejecute las pruebas de todos los componentes y otro que
  ejecute solo los componentes afectados por los cambios.
- **FR-003**: El repositorio MUST fijar y verificar las versiones mínimas de herramientas requeridas, fallando con un
  mensaje claro cuando no se cumplan. La versión del SDK móvil MUST fijarse por proyecto (FVM) sin requerir cambios en
  la instalación global del desarrollador.
- **FR-004**: El repositorio MUST incluir un archivo de ejemplo de configuración con todas las variables requeridas,
  valores ficticios y descripción; MUST NOT contener secretos reales.
- **FR-005**: La estructura de carpetas creada MUST corresponder a la estructura objetivo documentada; no se crean
  carpetas vacías sin propósito en esta feature.

**Servicio central y observabilidad**

- **FR-006**: El servicio central MUST exponer un chequeo de vida (proceso activo) y un chequeo de disponibilidad que
  verifique sus dependencias (al menos el almacén de datos), indicando cuál falla.
- **FR-007**: El servicio central MUST exponer una consulta de compatibilidad que informe la versión de API y la versión
  mínima soportada por app; los valores son configurables por entorno.
- **FR-008**: El servicio central MUST organizarse en módulos con límites explícitos y una capa de dominio sin
  dependencias de framework, persistencia, red ni UI; la regla MUST verificarse automáticamente.
- **FR-009**: Todo log MUST ser estructurado e incluir identificador de correlación (propagado o generado por
  solicitud), módulo, nivel y, cuando exista, identificador de empresa y actor (sin datos personales).
- **FR-010**: El sistema MUST redactar datos sensibles en logs (teléfonos, correos, identificadores fiscales,
  contraseñas, tokens, códigos de un solo uso, encabezados de autorización) y esto MUST estar cubierto por pruebas.
- **FR-011**: Toda respuesta de error MUST usar el formato estándar de errores definido en el contrato e incluir el
  identificador de correlación.
- **FR-039**: El servicio central MUST exponer métricas técnicas básicas en un formato estándar de extracción:
  solicitudes y latencia por ruta (plantilla, no ruta concreta), método y código de estado; errores por código estable
  del formato de errores; estado del pool de conexiones al almacén de datos; y métricas del proceso. Las métricas MUST NOT
  incluir datos personales, valores de encabezados ni identificadores de empresa como etiqueta, y MUST ser internas y
  protegidas según la tabla Endpoint Access (escucha solo local por defecto y credencial obligatoria del recolector
  fuera de local/testing o al escuchar en otra interfaz); no se sirven en el puerto de la API. Las métricas de negocio y las alertas por errores financieros (desbalance,
  falla de conciliación) se difieren a las features que introducen esas operaciones (006 ledger, 013 conciliación de
  caja), porque 001 no tiene operaciones financieras.
- **FR-040**: Cada endpoint de esta feature MUST declarar su acceso en la tabla Endpoint Access. Las excepciones a
  autenticación MUST cumplir la Constitución §II (justificación, entornos, clasificación de datos, controles
  compensatorios y pruebas de acceso permitido y denegado). Los chequeos de vida y disponibilidad MUST responder solo
  estado y nombres lógicos de dependencias con valor arriba/abajo, sin hosts, versiones ni mensajes de error.

**Aislamiento multi-tenant**

- **FR-012**: El sistema MUST establecer el contexto de empresa por operación a partir de la identidad del solicitante
  (en esta feature, un mecanismo técnico de prueba que 002 reemplazará por la identidad real), nunca a partir de datos
  arbitrarios del cuerpo de la solicitud.
- **FR-013**: El almacén de datos MUST aplicar aislamiento por empresa a nivel de fila, habilitado y forzado, en toda
  estructura con datos por empresa; una consulta sin contexto MUST devolver 0 filas.
- **FR-014**: La aplicación MUST conectarse con una cuenta sin capacidad de omitir el aislamiento ni de alterar
  estructuras; los cambios de estructura MUST usar una cuenta separada.
- **FR-015**: MUST existir una verificación automática que falle si alguna estructura con datos por empresa carece de
  aislamiento habilitado y forzado.
- **FR-016**: MUST existir una suite reutilizable de pruebas de acceso cruzado (lectura, listado, modificación,
  borrado, concurrencia) que las features futuras puedan aplicar declarando sus recursos.
- **FR-017**: MUST existir un recurso técnico de demostración (no de negocio, no expuesto en producción) para validar
  FR-012 a FR-016.
- **FR-018**: La herramienta de acceso a datos propuesta (D-ARC-01) MUST validarse mediante un spike documentado que
  demuestre FR-013, FR-014 y el escenario concurrente de US2; el resultado MUST registrarse para aprobar o rechazar
  ADR-0004.

**Dinero**

- **FR-019**: MUST existir una primitiva monetaria (monto en unidades mínimas + código de moneda) en el servicio central
  y en el paquete de dominio móvil, con suma/resta solo entre misma moneda, multiplicación por factores decimales con
  modo de redondeo obligatorio y reparto exacto en N partes, conforme a la representación aprobada en D-FIN-01
  (ADR-0007): rango representable, escala por moneda y forma canónica.
- **FR-020**: MUST existir un conjunto de fixtures numéricos compartidos (entradas y resultados esperados) ejecutado por
  ambos lados.
- **FR-021**: MUST existir una regla automatizada que rechace aritmética o tipos de punto flotante binario en código
  monetario/financiero del servicio central y del paquete de dominio móvil.
- **FR-022**: En la red, los montos MUST representarse sin pérdida de precisión según la convención del contrato.

**Idempotencia y auditoría**

- **FR-023**: MUST existir un mecanismo reutilizable de idempotencia por empresa, con esta política para 001:
  - misma clave y mismo contenido, operación completada → se devuelve el resultado original sin nuevo efecto,
    indicando que es una reproducción;
  - misma clave y mismo contenido, operación aún en proceso → rechazo HTTP 409 con `Retry-After`; al reintentar tras
    completarse, se recibe el resultado original;
  - misma clave y contenido distinto → rechazo explícito (conflicto de reutilización de clave);
  - solicitudes concurrentes con la misma clave → exactamente un efecto.
- **FR-024**: Las claves de idempotencia MUST conservarse 30 días desde su creación y su formato MUST validarse. Una
  clave expirada se trata como inexistente (una nueva solicitud con ella produce un nuevo efecto) y puede purgarse.
  Esta política es la del alcance técnico de 001; el motor de transacciones financieras (007) y la sincronización
  offline (011) MUST analizar y aprobar su propia política (ventana, reintentos, expiración) antes de adoptarla.
- **FR-025**: MUST existir una bitácora de auditoría append-only reutilizable que registre actor, rol del actor, empresa,
  acción, entidad, valores relevantes, fecha-hora del servidor, origen y correlación. El rol es opcional (nulo) en 001
  porque el contexto técnico no tiene modelo de identidad; desde 002 MUST derivarse del contexto de autorización
  confiable del servidor y MUST NOT aceptarse de un valor enviado por el cliente; la cuenta de aplicación MUST NOT poder
  modificar ni borrar registros.
- **FR-026**: El mecanismo de idempotencia y la auditoría MUST demostrarse sobre la operación técnica de FR-017.

**Contrato de API**

- **FR-027**: El contrato de API versionado MUST definir chequeos de salud, consulta de compatibilidad, la operación
  técnica de demostración (marcada como no productiva), formato estándar de errores, encabezado de clave de
  idempotencia, identificador de correlación y la representación de dinero.
- **FR-028**: El contrato MUST validarse con reglas de estilo, y los cambios incompatibles respecto a la rama principal
  MUST bloquear la fusión salvo cambio de versión mayor aprobado.
- **FR-029**: El cliente móvil MUST generarse desde el contrato y MUST verificarse que lo versionado coincide con lo
  generado.
- **FR-030**: Las respuestas del servicio central MUST verificarse contra el contrato mediante pruebas de contrato.

**Workspace móvil**

- **FR-031**: El workspace móvil MUST contener las tres apps como esqueletos ejecutables y los paquetes compartidos
  (núcleo, sistema de diseño, cliente de API, dominio financiero) con resolución de dependencias única.
- **FR-032**: Cada app MUST mostrar nombre, entorno y versión, y MUST poder consultar la compatibilidad del servicio
  central; MUST soportar al menos los entornos local, testing, staging y producción mediante configuración.
- **FR-033**: Las apps MUST NOT depender del código interno de otra app; la regla MUST verificarse automáticamente.

**Integración continua y colaboración**

- **FR-034**: CI MUST ejecutar solo las verificaciones de los componentes afectados, más verificaciones generales
  siempre (secretos, formato, nomenclatura de rama).
- **FR-035**: Los gates bloqueantes MUST incluir: lint, tipos, pruebas unitarias e integración, cobertura (dominio
  financiero ≥ 90 %, resto ≥ 80 %), contrato y compatibilidad, aislamiento multi-tenant, verificación de aislamiento de
  estructuras, escaneo de secretos, escaneo de dependencias (críticas/altas), reglas de dependencias de arquitectura y
  regla anti punto flotante. Para apps, CI MUST compilar Android y Web; la compilación iOS es local (no bloqueante en
  CI) hasta que se requiera distribución.
- **FR-036**: El repositorio MUST incluir asignación automática de revisores por área y la plantilla de PR con checklist
  de la Constitución. Con un único mantenedor, el gate es 1 aprobación humana + checklist + `/speckit-analyze` sin
  CRITICAL; la doble revisión en áreas financieras, autenticación y aislamiento MUST quedar configurada para activarse
  al registrarse un segundo mantenedor.
- **FR-037**: La configuración de CI MUST poder validarse localmente; MUST NOT publicarse en un repositorio remoto ni
  modificar políticas remotas sin aprobación explícita.
- **FR-038**: Las reglas de protección de la rama principal MUST documentarse listas para aplicar cuando exista el
  repositorio remoto.

### Key Entities *(include if feature involves data)*

- **Tenant (técnico)**: Identificador de empresa usado para el contexto y el aislamiento. En esta feature solo existe
  como identificador técnico de prueba; la entidad de negocio "Empresa" pertenece a 002.
- **Recurso técnico de demostración**: Registro sin significado de negocio que pertenece a un tenant; sirve para probar
  aislamiento, idempotencia y auditoría. No disponible en producción.
- **Registro de idempotencia**: Clave, empresa, huella del contenido, estado (en proceso/completado), resultado
  almacenado y fecha de expiración.
- **Registro de auditoría**: Actor, rol del actor (nulo en 001), empresa, acción, entidad e identificador, valores relevantes, fecha-hora del
  servidor, fecha-hora del dispositivo (opcional), origen y correlación. Inmutable.
- **Monto (Money)**: Valor en unidades mínimas + código de moneda; objeto de valor, no entidad persistida por sí misma.
- **Fixture numérico**: Caso con entradas, operación, modo de redondeo y resultado esperado, compartido por backend y
  apps.
- **Información de compatibilidad**: Versión de API y versión mínima soportada por app.

### Auditable Events

Eventos que MUST registrarse en la bitácora de auditoría (Constitución VII), todos con `actor_type = DEV` en 001:

| Acción | Cuándo | Entidad | Valores relevantes registrados |
|---|---|---|---|
| `dev_probe.created` | Creación confirmada (no en reproducciones idempotentes) | Recurso técnico | `label`, monto de muestra, `version` |
| `dev_probe.updated` | Actualización confirmada | Recurso técnico | `label` antes/después, `version` antes/después |
| `dev_probe.deleted` | Eliminación confirmada | Recurso técnico | `label` y `version` al eliminar |

- Una reproducción idempotente (misma clave y contenido) MUST NOT generar un nuevo evento.
- Las solicitudes rechazadas (validación, conflicto, acceso a recursos de otra empresa) no se auditan en 001; los
  eventos de seguridad (inicios de sesión, fallos de autorización) pertenecen a 002.

### Observability Signals

Métricas y eventos de log relevantes de esta feature (Constitución XIII):

- **Métricas** (FR-039): solicitudes y latencia por ruta/método/estado, errores por código estable, pool de conexiones
  al almacén de datos, métricas del proceso.
- **Eventos de log**: arranque y apagado (entorno, versión, módulos habilitados), arranque abortado por el guard de
  contexto técnico, cambio de estado del chequeo de disponibilidad, una línea por solicitud (ruta, estado, duración,
  correlación, empresa y actor si existen), errores no controlados (sin stack en la respuesta; con stack solo en log),
  conflictos de idempotencia (409/422) y conflictos de versión.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Siguiendo solo la guía, una persona nueva logra el **arranque local** (chequeo de disponibilidad "listo")
  en ≤ 15 minutos y el **arranque más la ejecución completa de las pruebas establecidas** (comando único de FR-002) en
  verde en ≤ 30 minutos. Medición: cronómetro desde el clon terminado hasta cada hito, en una máquina que cumple los
  prerrequisitos (verificación de entorno en verde: runtime del servicio central, contenedores, SDK móvil fijado);
  se excluye el tiempo de descarga de dependencias, imágenes de contenedor y SDK, que se mide y registra por separado.
  Verificado por alguien distinto de quien implementó (con mantenedor
  único: el mantenedor valida lo implementado por Claude Code, o lo hace en un clon limpio y se re-verifica al
  incorporarse un segundo integrante).
- **SC-002**: El 100 % de las pruebas de acceso cruzado pasan y 0 registros de una empresa son observables desde otra
  en todos los escenarios (lectura, listado, modificación, borrado, concurrente con ≥ 50 solicitudes intercaladas).
- **SC-003**: Cada uno de los 6 tipos de cambio defectuoso de referencia (secreto, punto flotante monetario, estructura
  sin aislamiento, contrato incompatible, dependencia prohibida de dominio, cobertura insuficiente) es bloqueado por CI
  en el 100 % de los intentos.
- **SC-004**: Un cambio que solo afecta documentación completa CI en ≤ 3 minutos; un cambio en un solo componente no
  ejecuta las suites de los demás.
- **SC-005**: El 100 % de los fixtures numéricos compartidos producen resultados idénticos en backend y apps.
- **SC-006**: Con 10 envíos de la misma operación (5 concurrentes), se observa exactamente 1 efecto y 1 registro de
  auditoría por efecto, en el 100 % de 100 ejecuciones repetidas.
- **SC-007**: 0 secretos reales en el historial del repositorio según el escáner de secretos.
- **SC-008**: Las tres apps inician y muestran su pantalla de inicio con información de compatibilidad obtenida del
  servicio local.
- **SC-009**: 0 ocurrencias de datos sensibles de prueba en los logs generados durante la suite completa.

## Security Risks *(Constitución II)*

| Riesgo | Actor / vector | Activo afectado | Mitigación en 001 | Verificación |
|---|---|---|---|---|
| Mecanismo técnico de contexto de empresa activo en producción | Configuración errónea o maliciosa | Aislamiento entre empresas | El servicio aborta el arranque si el mecanismo está habilitado en staging/producción; el recurso técnico no se registra fuera de local/testing | Prueba de arranque (FR-012, FR-017) |
| Fuga de contexto de empresa entre solicitudes por reutilización de conexiones | Concurrencia | Datos por empresa | Contexto fijado por transacción, nunca por sesión; aislamiento forzado en el almacén | Prueba concurrente ≥ 50 solicitudes (US2-6, SC-002) |
| Estructura nueva sin aislamiento | Error humano en futuras features | Datos por empresa | Verificación automática de catálogo bloqueante en CI | FR-015, US2-4 |
| Cuenta de aplicación con privilegios excesivos | Compromiso de la aplicación | Integridad de datos y bitácora | Cuenta sin omisión de aislamiento, sin cambios de estructura y sin modificar auditoría | FR-014, US2-5, US6-5 |
| Secretos versionados | Error humano | Credenciales | Solo archivo de ejemplo con valores ficticios; escáner de secretos sobre todo el historial | FR-004, SC-007 |
| Datos sensibles en logs o métricas | Error humano | Datos personales futuros | Redacción probada en logs; métricas sin etiquetas de empresa, encabezados ni datos personales | FR-010, FR-039, SC-009 |
| Métricas o chequeos que revelan detalles internos | Reconocimiento por un atacante | Topología, versiones, errores internos | Métricas internas con credencial del recolector; chequeos con respuesta mínima y esquema cerrado (ver Endpoint Access) | FR-006, FR-039, FR-040 |
| Cadena de suministro (dependencias, acciones de CI, imágenes) | Paquete o imagen comprometidos | Código y CI | Escaneo de dependencias bloqueante; acciones de CI fijadas por hash; imágenes de contenedor fijadas por digest | FR-035 |
| Duplicación de efectos por reintentos | Red inestable, reintentos del cliente | Integridad de operaciones | Idempotencia por empresa con manejo concurrente | FR-023, SC-006 |

Riesgos fuera de alcance (pertenecen a 002+): autenticación real, gestión de sesiones, fuerza bruta, exposición
pública de endpoints y cifrado en reposo en infraestructura gestionada (D-ARC-04).

## Endpoint Access *(Constitución II)*

001 no tiene autenticación real (llega en 002). Por eso **todos** sus endpoints son excepciones registradas; ninguno
lee ni modifica datos de tenant en `staging`/`production`.

| Ruta | Método | Autenticación | Autorización | Exposición de red | Entornos permitidos | Justificación |
|---|---|---|---|---|---|---|
| `/health/live` | GET | Ninguna (público) | Ninguna | Pública permitida | Todos | Sondas de orquestador; solo indica que el proceso responde |
| `/health/ready` | GET | Ninguna (público) | Ninguna | Pública permitida; interna recomendada | Todos | Sondas de enrutamiento; solo estado agregado y arriba/abajo por dependencia lógica |
| `/v1/meta/compatibility` | GET | Ninguna (público) | Ninguna | Pública | Todos | Las apps la consultan antes de autenticarse para saber si su versión está soportada |
| `/metrics` (escucha de métricas, fuera de la API) | GET | Credencial del recolector (token portador); opcional solo en `local`/`testing` con escucha local | Solo el recolector | Interna: escucha local por defecto; nunca en el puerto de la API | Todos, con credencial obligatoria fuera de `local`/`testing` o al escuchar en otra interfaz | Observabilidad (Constitución XIII) |
| `/v1/dev/probe-items`, `/v1/dev/probe-items/{id}` | POST, GET, PATCH, DELETE | **Ninguna**: el contexto técnico de empresa NO es autenticación | Aislamiento por empresa (RLS) con el contexto técnico | Local / runner de CI | Solo `local` y `testing` | Recurso técnico para demostrar aislamiento, idempotencia y auditoría antes de 002 |

### Registro de excepciones

| Endpoint | Datos expuestos (clasificación) | Controles compensatorios | Pruebas (permitido / denegado) |
|---|---|---|---|
| `/health/live` | Operativo, no sensible: `{status}` | Esquema cerrado; no consulta dependencias | 200 sin credenciales / sin campos adicionales |
| `/health/ready` | Operativo, no sensible: `status` y `checks.<nombre>.status` (`up`/`down`) | Esquema cerrado sin `detail`; el detalle del fallo solo va al log | 200 y 503 sin credenciales / la respuesta con la BD caída no contiene host, puerto, versión ni mensaje de error |
| `/v1/meta/compatibility` | Público por diseño: versión de API, versiones mínimas por app, hora del servidor | Esquema cerrado; no refleja encabezados; sin datos de build ni de infraestructura | 200 sin credenciales / sin campos adicionales; 400 con `X-App-Version` inválido |
| `/metrics` | Interno, no sensible por diseño: métricas técnicas sin etiquetas de empresa ni datos personales | Escucha `127.0.0.1` por defecto; token portador comparado en tiempo constante; el arranque falla fuera de `local`/`testing` (o con escucha no local) sin token | 200 con token / 401 sin token o con token inválido; arranque abortado sin token en `staging`/`production`; 404 en el puerto de la API |
| `/v1/dev/*` | Sintético (sin datos personales) | Módulo no registrado fuera de `local`/`testing`; el arranque aborta si el mecanismo está habilitado en `staging`/`production`; aislamiento RLS | Operaciones con contexto en `testing` / 401 sin contexto; 404 en todas las rutas `/v1/dev/*` con configuración `staging`/`production`, enviando o no el encabezado técnico |

La exposición de red definitiva (balanceador, red interna, autenticación del recolector en producción) se decide con
el despliegue (D-ARC-04); 001 garantiza los controles de aplicación descritos.

## Personal Data Inventory *(Constitución XV)*

**Ninguno.** Esta feature no recolecta, almacena ni procesa datos personales. Los datos del recurso técnico, de la
bitácora y de las pruebas son sintéticos; los identificadores de actor son técnicos (no personas). La redacción de logs
(FR-010) se prueba con datos sensibles ficticios para preparar features futuras. Las features que introduzcan datos
personales (002, 003) MUST declarar su propio inventario.

## Assumptions

- El stack (servicio central, almacén de datos, framework móvil, formato de contrato, CI) está fijado por la
  Constitución y los ADR (estado al 2026-11-22: ADR-0001, ADR-0003 y ADR-0007 aceptados; ADR-0002, ADR-0005 y
  ADR-0006 aceptados con condiciones que no afectan a 001, salvo C2-1, que 001 implementa; ADR-0004 propuesto y
  condicionado al spike de FR-018).
- **D-ENV-01** (versión del SDK móvil): **resuelta** — Flutter fijado por proyecto con FVM en una versión stable con
  Dart ≥ 3.6; la instalación global no se modifica.
- **D-FIN-01** (representación monetaria): **aprobada** — montos enteros en unidades mínimas + moneda ISO 4217, tasas
  decimales exactas; reglas en ADR-0007. Sustenta FR-019..FR-022 (US4). Las reglas de redondeo de negocio (D-FIN-02)
  siguen pendientes y no se implementan aquí: cada operación recibe el modo de redondeo explícitamente.
- **D-ARC-02** (estado de las apps): **aprobada** — Riverpod (ADR-0003); los shells de US7 lo usan.
- **D-ARC-03** (tecnología del administrador web): **pendiente**. Para esta feature se autoriza Flutter Web solo de forma
  provisional para el shell de administración (arranque, entorno y build web); no aprueba la tecnología definitiva.
- **D-ARC-01** (herramienta de acceso a datos): se asume la recomendación (Prisma) condicionada al spike de FR-018; si
  el spike falla, se replanifica con la alternativa documentada en ADR-0004 antes de continuar con US2.
- La identidad real de usuarios y empresas pertenece a 002; aquí el contexto de empresa se fija con un mecanismo
  técnico solo habilitado en entornos no productivos.
- Plataformas objetivo de apps móviles: Android e iOS para cobradores y clientes; web para administración. CI compila
  Android y Web; iOS se compila localmente (ver Clarifications).
- No existe todavía repositorio remoto; CI se define y valida localmente (p. ej. ejecutando los mismos comandos que los
  jobs) y se activa cuando se apruebe publicar el repositorio.
- Ventana de retención de claves de idempotencia: 30 días (FR-024), solo para el alcance técnico de 001.
- Ventana de soporte de versiones de apps (D-ARC-05) no afecta esta feature más allá de exponer el dato configurable.
- No se aprovisiona ningún servicio cloud (D-ARC-04); todo corre localmente o en ejecutores de CI.
- **Asignación automática de revisores (FR-036, US3-8)**: el archivo de dueños por área se crea con un marcador de
  posición, no con un usuario real. Su funcionamiento queda **pendiente de validación** hasta que exista el
  repositorio remoto aprobado y un identificador GitHub válido del mantenedor; no se considera verificado en 001.
