# Privacidad y protección de datos

> Estado: **Propuesto** · 2026-11-22 · Principio constitucional: **XV. Protección de datos**.
> La ley aplicable depende del país de operación (**D-LEG-01**, no confirmado) y se valida en **D-LEG-02**.
> Este documento define controles técnicos; **no** afirma cumplimiento legal. Lo no validado se marca **PENDIENTE-LEGAL**.

## 1. Roles respecto a los datos

Cada empresa (tenant) es responsable de los datos de sus clientes; Kuota actúa como proveedor tecnológico que los trata por
cuenta del tenant. Los términos exactos (responsable/encargado, contrato de tratamiento) son **PENDIENTE-LEGAL**.

## 2. Inventario de datos personales

| Categoría | Ejemplos | Titular | Sensibilidad | Propósito | Feature |
|---|---|---|---|---|---|
| Identificación | Nombre, fecha de nacimiento, identificador oficial/fiscal | Cliente, staff | Alta | Identificar al cliente, KYC (D-LEG-03) | 003 |
| Contacto | Teléfono, correo, domicilio | Cliente, staff | Media | Comunicación, cobranza en campo | 002, 003 |
| Geolocalización | Ubicación del domicilio, ubicación del cobro | Cliente, cobrador | Alta | Rutas, evidencia de cobro (a validar si se recolecta) | 010 |
| Financieros | Préstamos, pagos, ahorro, garantías, historial | Cliente | Alta | Operación del servicio | 005–009 |
| Documentos | Imágenes de identificación, comprobantes | Cliente | Alta | KYC | 003 |
| Autenticación | Hash de PIN/contraseña, llaves públicas de dispositivo, historial de sesiones | Todos | Alta | Seguridad | 002 |
| Biométricos | **No se recolectan**: la biometría queda en el SO del dispositivo | — | — | — | 002 |
| Laborales | Asignación de rutas, cortes de caja, diferencias | Cobrador | Media | Operación y control | 013 |
| Técnicos | `device_id`, IP, versión de app | Todos | Baja-media | Seguridad, soporte | 001 |

Cada `spec.md` DEBE incluir su propio inventario (campo, propósito, retención, quién accede).

## 3. Minimización

- No se recolecta un dato sin propósito definido en la spec.
- La app de cobrador solo descarga los clientes **asignados** a su ruta y los campos necesarios para cobrar.
- Los datos de verificación pública de recibos muestran solo empresa, folio, fecha, monto, estado e iniciales.
- Exportaciones y reportes excluyen PII por defecto; incluirla requiere permiso específico y queda auditado.

## 4. Enmascaramiento por rol

| Dato | Admin tenant | Supervisor | Analista crédito | Cobrador | Cliente (propio) | Plataforma (soporte) |
|---|---|---|---|---|---|---|
| Nombre completo | ✅ | ✅ | ✅ | ✅ | ✅ | Enmascarado |
| Teléfono | ✅ | ✅ | ✅ | Últimos 4 + botón de llamada | ✅ | Enmascarado |
| Identificador oficial/fiscal | ✅ (con auditoría) | Enmascarado | ✅ (con auditoría) | ❌ | Enmascarado | ❌ salvo break-glass |
| Documentos KYC | ✅ (con auditoría) | ❌ | ✅ (con auditoría) | ❌ | ✅ | ❌ salvo break-glass |
| Domicilio | ✅ | ✅ | ✅ | ✅ (asignados) | ✅ | Enmascarado |
| Saldos/historial | ✅ | ✅ | ✅ | Asignados | ✅ | Agregados |

La matriz final se aprueba en 002/003; el enmascaramiento se aplica **en backend** (no solo en UI).

## 5. Cifrado

| Ámbito | Control |
|---|---|
| Tránsito | TLS 1.2+ (preferente 1.3) en todo tráfico; HSTS en web; *certificate pinning* en apps móviles (evaluar) |
| Reposo – servidor | Cifrado de disco/volumen de BD y respaldos; cifrado a nivel de campo para identificador oficial y documentos (evaluar en 003) |
| Reposo – móvil | BD Drift cifrada (SQLCipher o equivalente) con llave en Keychain/Keystore; borrado remoto |
| Documentos | Almacenamiento de objetos cifrado, URLs firmadas de vida corta |
| Secretos | Almacén de secretos del entorno; nunca en el repositorio (escaneo en CI) |

## 6. Logs y observabilidad sin PII

- Los logs usan identificadores (UUID) y nunca: nombres, teléfonos, correos, identificadores oficiales, domicilios,
  tokens, OTP, PIN, contenido de documentos.
- Un *redactor* central en el logger elimina campos por lista de denegación y patrones (teléfono, correo); probado con
  pruebas unitarias (principio XIII).
- Los reportes de errores de apps (crash reporting) se configuran sin PII y sin capturas de pantalla.

## 7. Retención y eliminación — PENDIENTE-LEGAL

| Dato | Propuesta técnica | Estado |
|---|---|---|
| Registros financieros y ledger | Retención larga; el ledger no se borra (inmutabilidad), se puede **seudonimizar** el titular al vencer la retención | PENDIENTE-LEGAL (plazo) |
| Documentos KYC | Retención según obligación aplicable tras fin de relación | PENDIENTE-LEGAL (D-LEG-03) |
| Logs técnicos | 30–90 días | Decisión técnica pendiente |
| Datos locales del cobrador | Se eliminan al confirmar sincronización y al salir el cliente de la ruta | Técnico |
| Auditoría | Retención larga, append-only | PENDIENTE-LEGAL |

Tensión conocida: el principio de inmutabilidad del ledger frente a solicitudes de eliminación se resuelve separando
identidad (borrable/seudonimizable) de movimientos contables (conservados con referencia seudónima). A validar con legal.

## 8. Derechos de los titulares

Se prevén capacidades técnicas para: acceso (exportación de datos propios desde Kuota Client o vía tenant), rectificación
(flujo en 003 con auditoría), cancelación/supresión (sujeta a retención obligatoria), oposición y revocación de consentimiento.
Plazos, procedimientos y avisos de privacidad: **PENDIENTE-LEGAL** (D-LEG-02). El canal de atención es responsabilidad
del tenant, con soporte técnico de Kuota.

## 9. Transferencias y residencia

Ubicación de servidores, proveedores (SMS/WhatsApp, cloud) y transferencias internacionales: **D-BIZ-02 / D-ARC-04**, pendientes.
