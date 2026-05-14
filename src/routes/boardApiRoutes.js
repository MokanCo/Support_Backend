import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import multer from 'multer';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { AppError } from '../utils/AppError.js';
import Board from '../models/Board.js';
import BoardColumn from '../models/BoardColumn.js';
import BoardTask from '../models/BoardTask.js';
import BoardTaskAttachment from '../models/BoardTaskAttachment.js';
import TaskComment from '../models/TaskComment.js';
import User from '../models/User.js';
import { columnNameToTaskStatus } from '../utils/boardColumnTicketMap.js';
import { normalizeCardColor, normalizeProgress } from '../utils/boardTaskCardColors.js';
import { serializeTasksWithUsers } from '../services/boardSerialize.js';
import { moveBoardTask } from '../services/boardTaskMoveService.js';
import { notifyMentionedUsersInComment } from '../services/boardMentionNotifyService.js';

const router = Router();

const BOARD_UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'board-task-files');
try {
  fs.mkdirSync(BOARD_UPLOAD_ROOT, { recursive: true });
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[boards] could not create upload dir', e);
}

const boardTaskUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, BOARD_UPLOAD_ROOT);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 32);
      const base = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      cb(null, `${base}${ext || ''}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

async function unlinkBoardFilesForAttachments(rows) {
  for (const row of rows) {
    if (!row?.storedName) continue;
    const fp = path.join(BOARD_UPLOAD_ROOT, row.storedName);
    // eslint-disable-next-line no-await-in-loop
    await fs.promises.unlink(fp).catch(() => {});
  }
}

async function purgeAttachmentsForTaskIds(taskIds) {
  if (!taskIds?.length) return;
  const rows = await BoardTaskAttachment.find({ taskId: { $in: taskIds } }).lean();
  await unlinkBoardFilesForAttachments(rows);
  await BoardTaskAttachment.deleteMany({ taskId: { $in: taskIds } });
}

router.use(authMiddleware);
router.use((req, _res, next) => {
  if (req.user.role === 'partner') {
    return next(new AppError('Forbidden', 403));
  }
  next();
});

function oid(id) {
  if (!id || !mongoose.isValidObjectId(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

async function boardVisibleToUser(boardId, user) {
  const board = await Board.findById(boardId).lean();
  if (!board) return null;
  if (user.role === 'admin') return { board };
  const onBoard = (board.users || []).some((u) => String(u) === user.id);
  if (user.role === 'support' && onBoard) return { board };
  return null;
}

function userMayEditTaskOnBoard(user, vis) {
  if (!vis) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'support') return false;
  return (vis.board.users || []).some((u) => String(u) === user.id);
}

router.get('/boards', async (req, res, next) => {
  try {
    const q =
      req.user.role === 'admin'
        ? {}
        : { users: new mongoose.Types.ObjectId(req.user.id) };
    const boards = await Board.find(q).sort({ createdAt: -1 }).lean();
    res.json({
      boards: boards.map((b) => ({
        id: String(b._id),
        name: b.name,
        description: b.description,
        createdBy: String(b.createdBy),
        users: (b.users || []).map(String),
        notifyOnCompleteUsers: (b.notifyOnCompleteUsers || []).map(String),
        createdAt: b.createdAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/boards', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new AppError('Only admins can create boards', 403);
    const { name, description, users: userIds, notifyOnCompleteUsers: notifyIds } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) throw new AppError('name required', 400);
    const users = (Array.isArray(userIds) ? userIds : [])
      .map((id) => oid(String(id)))
      .filter(Boolean);
    const notify = (Array.isArray(notifyIds) ? notifyIds : [])
      .map((id) => oid(String(id)))
      .filter(Boolean);
    const board = await Board.create({
      name: name.trim().slice(0, 200),
      description: typeof description === 'string' ? description.trim().slice(0, 4000) : '',
      createdBy: new mongoose.Types.ObjectId(req.user.id),
      users,
      notifyOnCompleteUsers: notify,
    });
    res.status(201).json({ id: String(board._id) });
  } catch (e) {
    next(e);
  }
});

router.get('/board/members', async (req, res, next) => {
  try {
    const boardId = oid(String(req.query.boardId || ''));
    if (!boardId) throw new AppError('boardId query required', 400);
    const vis = await boardVisibleToUser(boardId, req.user);
    if (!vis) throw new AppError('Board not found', 404);
    const { board } = vis;
    const ids = new Set();
    ids.add(String(board.createdBy));
    for (const u of board.users || []) ids.add(String(u));
    const users = await User.find({ _id: { $in: [...ids].map((id) => oid(id)).filter(Boolean) } })
      .select('name email role')
      .lean();
    res.json({
      members: users.map((u) => ({
        id: String(u._id),
        name: u.name || '',
        email: u.email || '',
        role: u.role || '',
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/boards/:id', async (req, res, next) => {
  try {
    const boardId = oid(req.params.id);
    if (!boardId) throw new AppError('Invalid board id', 400);
    const vis = await boardVisibleToUser(boardId, req.user);
    if (!vis) throw new AppError('Board not found', 404);
    const { board } = vis;
    const columns = await BoardColumn.find({ boardId }).sort({ order: 1 }).lean();
    const tasks = await BoardTask.find({ boardId }).sort({ columnId: 1, order: 1 }).lean();
    res.json({
      board: {
        id: String(board._id),
        name: board.name,
        description: board.description,
        createdBy: String(board.createdBy),
        users: (board.users || []).map(String),
        notifyOnCompleteUsers: (board.notifyOnCompleteUsers || []).map(String),
        createdAt: board.createdAt,
      },
      columns: columns.map((c) => ({
        id: String(c._id),
        name: c.name,
        boardId: String(c.boardId),
        order: c.order,
      })),
      tasks: await serializeTasksWithUsers(tasks),
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/boards/:id', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new AppError('Only admins can update boards', 403);
    const boardId = oid(req.params.id);
    if (!boardId) throw new AppError('Invalid board id', 400);
    const patch = {};
    if (req.body.name != null) patch.name = String(req.body.name).trim().slice(0, 200);
    if (req.body.description != null) patch.description = String(req.body.description).trim().slice(0, 4000);
    if (Array.isArray(req.body.users))
      patch.users = req.body.users.map((id) => oid(String(id))).filter(Boolean);
    if (Array.isArray(req.body.notifyOnCompleteUsers))
      patch.notifyOnCompleteUsers = req.body.notifyOnCompleteUsers
        .map((id) => oid(String(id)))
        .filter(Boolean);
    const r = await Board.updateOne({ _id: boardId }, { $set: patch });
    if (r.matchedCount === 0) throw new AppError('Not found', 404);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete('/boards/:id', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new AppError('Only admins can delete boards', 403);
    const boardId = oid(req.params.id);
    if (!boardId) throw new AppError('Invalid board id', 400);
    const taskIds = await BoardTask.find({ boardId }).distinct('_id');
    await purgeAttachmentsForTaskIds(taskIds);
    await TaskComment.deleteMany({ taskId: { $in: taskIds } });
    await BoardTask.deleteMany({ boardId });
    await BoardColumn.deleteMany({ boardId });
    const r = await Board.deleteOne({ _id: boardId });
    if (r.deletedCount === 0) throw new AppError('Not found', 404);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/columns', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new AppError('Only admins can create columns', 403);
    const { boardId: bid, name, order } = req.body;
    const bId = oid(String(bid || ''));
    if (!bId) throw new AppError('Invalid boardId', 400);
    if (!name || typeof name !== 'string' || !name.trim()) throw new AppError('name required', 400);
    const board = await Board.findById(bId);
    if (!board) throw new AppError('Board not found', 404);
    let ord = order;
    if (ord == null) {
      const max = await BoardColumn.find({ boardId: bId }).sort({ order: -1 }).limit(1).lean();
      ord = max[0] ? max[0].order + 1 : 0;
    }
    const col = await BoardColumn.create({ boardId: bId, name: name.trim().slice(0, 120), order: ord });
    res.status(201).json({ id: String(col._id) });
  } catch (e) {
    next(e);
  }
});

router.get('/columns', async (req, res, next) => {
  try {
    const boardId = oid(String(req.query.boardId || ''));
    if (!boardId) throw new AppError('boardId query required', 400);
    const vis = await boardVisibleToUser(boardId, req.user);
    if (!vis) throw new AppError('Board not found', 404);
    const columns = await BoardColumn.find({ boardId }).sort({ order: 1 }).lean();
    res.json({
      columns: columns.map((c) => ({
        id: String(c._id),
        name: c.name,
        boardId: String(c.boardId),
        order: c.order,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/columns/:id', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new AppError('Only admins can update columns', 403);
    const colId = oid(req.params.id);
    if (!colId) throw new AppError('Invalid id', 400);
    const $set = {};
    if (req.body.name != null) $set.name = String(req.body.name).trim().slice(0, 120);
    if (req.body.order != null) $set.order = Number(req.body.order);
    const r = await BoardColumn.updateOne({ _id: colId }, { $set });
    if (r.matchedCount === 0) throw new AppError('Not found', 404);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete('/columns/:id', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new AppError('Only admins can delete columns', 403);
    const colId = oid(req.params.id);
    if (!colId) throw new AppError('Invalid id', 400);
    const n = await BoardTask.countDocuments({ columnId: colId });
    if (n > 0) throw new AppError('Column still has tasks', 400);
    const r = await BoardColumn.deleteOne({ _id: colId });
    if (r.deletedCount === 0) throw new AppError('Not found', 404);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/tasks', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new AppError('Only admins can create tasks', 403);
    const {
      title,
      description,
      ticketId,
      boardId,
      columnId,
      assignedTo,
      priority,
      deadline,
      cardColor,
      progress,
    } = req.body;
    const bId = oid(String(boardId || ''));
    const cId = oid(String(columnId || ''));
    if (!bId || !cId) throw new AppError('Invalid board or column id', 400);
    if (!title || typeof title !== 'string' || !title.trim()) throw new AppError('title required', 400);
    const col = await BoardColumn.findOne({ _id: cId, boardId: bId });
    if (!col) throw new AppError('Column not on board', 400);
    const ticketOid = ticketId ? oid(String(ticketId)) : null;
    if (ticketId && !ticketOid) throw new AppError('Invalid ticketId', 400);
    const assignOid = assignedTo ? oid(String(assignedTo)) : null;
    if (assignedTo && !assignOid) throw new AppError('Invalid assignedTo', 400);
    const maxOrder = await BoardTask.find({ columnId: cId }).sort({ order: -1 }).limit(1).lean();
    const ord = maxOrder[0] ? maxOrder[0].order + 1 : 0;
    const task = await BoardTask.create({
      title: title.trim().slice(0, 500),
      description: typeof description === 'string' ? description.trim().slice(0, 20000) : '',
      ticketId: ticketOid,
      boardId: bId,
      columnId: cId,
      assignedTo: assignOid,
      priority: ['low', 'medium', 'high', 'urgent'].includes(priority) ? priority : 'medium',
      cardColor: normalizeCardColor(cardColor),
      progress: normalizeProgress(progress),
      deadline: deadline ? new Date(deadline) : null,
      status: columnNameToTaskStatus(col.name),
      order: ord,
      createdBy: new mongoose.Types.ObjectId(req.user.id),
    });
    res.status(201).json({ id: String(task._id) });
  } catch (e) {
    next(e);
  }
});

router.get('/tasks', async (req, res, next) => {
  try {
    const boardId = oid(String(req.query.boardId || ''));
    if (!boardId) throw new AppError('boardId query required', 400);
    const vis = await boardVisibleToUser(boardId, req.user);
    if (!vis) throw new AppError('Board not found', 404);
    const tasks = await BoardTask.find({ boardId }).sort({ columnId: 1, order: 1 }).lean();
    res.json({ tasks: await serializeTasksWithUsers(tasks) });
  } catch (e) {
    next(e);
  }
});

router.post('/tasks/move', async (req, res, next) => {
  try {
    const { taskId, destinationColumnId, newOrder } = req.body;
    if (!taskId || !destinationColumnId || newOrder === undefined) {
      throw new AppError('taskId, destinationColumnId, newOrder required', 400);
    }
    const task = await BoardTask.findById(taskId).lean();
    if (!task) throw new AppError('Task not found', 404);
    const vis = await boardVisibleToUser(task.boardId, req.user);
    if (!vis) throw new AppError('Forbidden', 403);
    if (req.user.role !== 'admin') {
      const onBoard = (vis.board.users || []).some((u) => String(u) === req.user.id);
      if (!onBoard) throw new AppError('Forbidden', 403);
    }
    try {
      await moveBoardTask({
        taskId: String(taskId),
        destinationColumnId: String(destinationColumnId),
        newOrder: Number(newOrder),
      });
    } catch (err) {
      if (err.statusCode) throw new AppError(err.message, err.statusCode);
      throw err;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/tasks/comments', async (req, res, next) => {
  try {
    const { taskId, comment } = req.body;
    const tid = oid(String(taskId || ''));
    if (!tid) throw new AppError('Invalid taskId', 400);
    if (!comment || typeof comment !== 'string' || !comment.trim()) throw new AppError('comment required', 400);
    const task = await BoardTask.findById(tid).lean();
    if (!task) throw new AppError('Task not found', 404);
    const vis = await boardVisibleToUser(task.boardId, req.user);
    if (!vis) throw new AppError('Forbidden', 403);
    const trimmed = comment.trim().slice(0, 8000);
    const c = await TaskComment.create({
      taskId: tid,
      userId: new mongoose.Types.ObjectId(req.user.id),
      comment: trimmed,
    });
    const base = (process.env.APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const taskUrl = base
      ? `${base}/dashboard/boards?board=${String(task.boardId)}&task=${String(task._id)}`
      : '';
    void notifyMentionedUsersInComment({
      comment: trimmed,
      taskTitle: task.title || 'Board task',
      taskUrl,
      authorId: req.user.id,
      authorName: req.user.name || req.user.email || 'Teammate',
    }).catch(() => {});
    res.status(201).json({ id: String(c._id) });
  } catch (e) {
    next(e);
  }
});

router.get('/tasks/comments', async (req, res, next) => {
  try {
    const tid = oid(String(req.query.taskId || ''));
    if (!tid) throw new AppError('taskId query required', 400);
    const task = await BoardTask.findById(tid).lean();
    if (!task) throw new AppError('Task not found', 404);
    const vis = await boardVisibleToUser(task.boardId, req.user);
    if (!vis) throw new AppError('Forbidden', 403);
    const rows = await TaskComment.find({ taskId: tid })
      .sort({ createdAt: 1 })
      .populate('userId', 'name email')
      .lean();
    res.json({
      comments: rows.map((r) => ({
        id: String(r._id),
        taskId: String(r.taskId),
        user:
          r.userId && typeof r.userId === 'object'
            ? {
                id: String(r.userId._id),
                name: r.userId.name || '',
                email: r.userId.email || '',
              }
            : { id: String(r.userId), name: '', email: '' },
        comment: r.comment,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/tasks/attachments/:attachmentId/download', async (req, res, next) => {
  try {
    const aid = oid(req.params.attachmentId);
    if (!aid) throw new AppError('Invalid attachment id', 400);
    const row = await BoardTaskAttachment.findById(aid).lean();
    if (!row) throw new AppError('Not found', 404);
    const task = await BoardTask.findById(row.taskId).lean();
    if (!task) throw new AppError('Not found', 404);
    const vis = await boardVisibleToUser(task.boardId, req.user);
    if (!vis) throw new AppError('Forbidden', 403);
    const fp = path.join(BOARD_UPLOAD_ROOT, row.storedName);
    try {
      await fs.promises.access(fp);
    } catch {
      throw new AppError('File missing', 404);
    }
    res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${String(row.originalName || 'file').replace(/"/g, '')}"`,
    );
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    next(e);
  }
});

router.delete('/tasks/attachments/:attachmentId', async (req, res, next) => {
  try {
    const aid = oid(req.params.attachmentId);
    if (!aid) throw new AppError('Invalid attachment id', 400);
    const row = await BoardTaskAttachment.findById(aid);
    if (!row) throw new AppError('Not found', 404);
    const task = await BoardTask.findById(row.taskId).lean();
    if (!task) throw new AppError('Not found', 404);
    const vis = await boardVisibleToUser(task.boardId, req.user);
    if (!vis) throw new AppError('Forbidden', 403);
    const isUploader = String(row.uploadedBy) === req.user.id;
    if (req.user.role !== 'admin' && !isUploader) throw new AppError('Forbidden', 403);
    const fp = path.join(BOARD_UPLOAD_ROOT, row.storedName);
    await fs.promises.unlink(fp).catch(() => {});
    await BoardTaskAttachment.deleteOne({ _id: aid });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/tasks/:taskId/attachments', async (req, res, next) => {
  try {
    const taskId = oid(req.params.taskId);
    if (!taskId) throw new AppError('Invalid task id', 400);
    const task = await BoardTask.findById(taskId).lean();
    if (!task) throw new AppError('Task not found', 404);
    const vis = await boardVisibleToUser(task.boardId, req.user);
    if (!vis) throw new AppError('Forbidden', 403);
    const rows = await BoardTaskAttachment.find({ taskId }).sort({ createdAt: -1 }).lean();
    res.json({
      attachments: rows.map((r) => ({
        id: String(r._id),
        taskId: String(r.taskId),
        originalName: r.originalName,
        mimeType: r.mimeType,
        size: r.size,
        uploadedBy: String(r.uploadedBy),
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/tasks/:taskId/attachments', (req, res, next) => {
  boardTaskUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return next(new AppError(err.message, 400));
      }
      return next(err);
    }
    next();
  });
}, async (req, res, next) => {
  try {
    const taskId = oid(req.params.taskId);
    if (!taskId) throw new AppError('Invalid task id', 400);
    const task = await BoardTask.findById(taskId).lean();
    if (!task) throw new AppError('Task not found', 404);
    const vis = await boardVisibleToUser(task.boardId, req.user);
    if (!vis) throw new AppError('Forbidden', 403);
    if (!userMayEditTaskOnBoard(req.user, vis)) throw new AppError('Forbidden', 403);
    if (!req.file) throw new AppError('file required', 400);
    const doc = await BoardTaskAttachment.create({
      taskId,
      uploadedBy: new mongoose.Types.ObjectId(req.user.id),
      originalName: String(req.file.originalname || 'file').trim().slice(0, 500),
      storedName: req.file.filename,
      mimeType: String(req.file.mimetype || 'application/octet-stream').slice(0, 200),
      size: req.file.size,
    });
    res.status(201).json({
      id: String(doc._id),
      attachment: {
        id: String(doc._id),
        taskId: String(doc.taskId),
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        size: doc.size,
        uploadedBy: String(doc.uploadedBy),
        createdAt: doc.createdAt,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/tasks/:id', async (req, res, next) => {
  try {
    const taskId = oid(req.params.id);
    if (!taskId) throw new AppError('Invalid id', 400);
    const task = await BoardTask.findById(taskId).lean();
    if (!task) throw new AppError('Not found', 404);
    const vis = await boardVisibleToUser(task.boardId, req.user);
    if (!vis) throw new AppError('Not found', 404);
    const [out] = await serializeTasksWithUsers([task]);
    res.json({ task: out });
  } catch (e) {
    next(e);
  }
});

router.patch('/tasks/:id', async (req, res, next) => {
  try {
    const taskId = oid(req.params.id);
    if (!taskId) throw new AppError('Invalid id', 400);
    const task = await BoardTask.findById(taskId);
    if (!task) throw new AppError('Not found', 404);
    const vis = await boardVisibleToUser(task.boardId, req.user);
    if (!vis) throw new AppError('Not found', 404);
    if (!userMayEditTaskOnBoard(req.user, vis)) throw new AppError('Forbidden', 403);
    const $set = { updatedAt: new Date() };
    if (req.body.title != null) $set.title = String(req.body.title).trim().slice(0, 500);
    if (req.body.description != null) $set.description = String(req.body.description).trim().slice(0, 20000);
    if (['low', 'medium', 'high', 'urgent'].includes(req.body.priority)) $set.priority = req.body.priority;
    if (req.body.deadline !== undefined) $set.deadline = req.body.deadline ? new Date(req.body.deadline) : null;
    if (req.body.assignedTo !== undefined) {
      const raw = req.body.assignedTo;
      $set.assignedTo = raw ? oid(String(raw)) : null;
      if (raw && !$set.assignedTo) throw new AppError('Invalid assignedTo', 400);
    }
    if (req.body.cardColor != null) $set.cardColor = normalizeCardColor(req.body.cardColor);
    if (req.body.progress !== undefined) $set.progress = normalizeProgress(req.body.progress);
    if (req.user.role === 'admin') {
      if (['in_queue', 'in_progress', 'completed', 'cancelled'].includes(req.body.status))
        $set.status = req.body.status;
      if (req.body.ticketId !== undefined)
        $set.ticketId = req.body.ticketId ? oid(String(req.body.ticketId)) : null;
      if (req.body.columnId != null) {
        const cid = oid(String(req.body.columnId));
        if (!cid) throw new AppError('Invalid columnId', 400);
        const col = await BoardColumn.findOne({ _id: cid, boardId: task.boardId });
        if (!col) throw new AppError('Invalid column', 400);
        $set.columnId = cid;
        $set.status = columnNameToTaskStatus(col.name);
      }
    }
    await BoardTask.updateOne({ _id: taskId }, { $set });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete('/tasks/:id', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new AppError('Only admins can delete tasks', 403);
    const taskId = oid(req.params.id);
    if (!taskId) throw new AppError('Invalid id', 400);
    await purgeAttachmentsForTaskIds([taskId]);
    await TaskComment.deleteMany({ taskId });
    const r = await BoardTask.deleteOne({ _id: taskId });
    if (r.deletedCount === 0) throw new AppError('Not found', 404);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
