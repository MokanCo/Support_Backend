import { ReceptionistAudit } from '../models/receptionist.js';

export async function recordAudit(user, action, entityType, entityId, locationId = null) {
  await ReceptionistAudit.create({
    actorId: user?.id ?? null,
    action,
    entityType,
    entityId: entityId ? String(entityId) : '',
    locationId: locationId || null,
  });
}

export async function listAudit(limit = 20) {
  const rows = await ReceptionistAudit.find()
    .sort({ createdAt: -1 })
    .limit(Math.min(50, Math.max(1, limit)))
    .lean();
  return rows.map((row) => ({
    id: String(row._id),
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    locationId: row.locationId ? String(row.locationId) : null,
    createdAt: row.createdAt,
  }));
}
