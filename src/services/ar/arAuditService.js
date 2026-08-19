import ArAuditLog from '../../models/ArAuditLog.js';

export async function writeArAudit({
  entityType,
  entityId,
  action,
  description,
  previousValue = null,
  newValue = null,
  actor = null,
  ipAddress = '',
}) {
  return ArAuditLog.create({
    entityType,
    entityId: entityId != null ? String(entityId) : '',
    action,
    description: description || '',
    previousValue,
    newValue,
    userId: actor?.id || null,
    userName: actor?.name || actor?.email || '',
    ipAddress: ipAddress || '',
  });
}

export async function listArAuditLogs(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50));
  const filter = {};
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = String(query.entityId);
  if (query.action) filter.action = query.action;

  const [items, total] = await Promise.all([
    ArAuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    ArAuditLog.countDocuments(filter),
  ]);

  return {
    logs: items.map((d) => ({
      id: String(d._id),
      entityType: d.entityType,
      entityId: d.entityId,
      action: d.action,
      description: d.description,
      previousValue: d.previousValue,
      newValue: d.newValue,
      userId: d.userId ? String(d.userId) : null,
      userName: d.userName,
      ipAddress: d.ipAddress,
      createdAt: d.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
