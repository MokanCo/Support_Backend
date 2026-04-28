import mongoose from 'mongoose';
import BoardColumn from '../models/BoardColumn.js';
import BoardTask from '../models/BoardTask.js';
import Ticket from '../models/Ticket.js';
import Board from '../models/Board.js';
import User from '../models/User.js';
import {
  columnNameToTaskStatus,
  columnNameToTicketStatus,
  isDoneLikeColumnName,
} from '../utils/boardColumnTicketMap.js';
import { sendTaskCompleteEmails, sendTicketCompletedEmails } from './boardMailService.js';
import { getTicketCompletionMailContext } from './ticketStakeholderEmails.js';

/**
 * @param {{ taskId: string, destinationColumnId: string, newOrder: number }} input
 */
export async function moveBoardTask(input) {
  const { taskId, destinationColumnId, newOrder } = input;
  if (!mongoose.isValidObjectId(taskId) || !mongoose.isValidObjectId(destinationColumnId)) {
    const e = new Error('Invalid id');
    e.statusCode = 400;
    throw e;
  }
  if (!Number.isInteger(newOrder) || newOrder < 0) {
    const e = new Error('newOrder must be a non-negative integer');
    e.statusCode = 400;
    throw e;
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const task = await BoardTask.findById(taskId).session(session);
    if (!task) {
      await session.abortTransaction();
      const e = new Error('Task not found');
      e.statusCode = 404;
      throw e;
    }

    const destCol = await BoardColumn.findById(destinationColumnId).session(session);
    if (!destCol || String(destCol.boardId) !== String(task.boardId)) {
      await session.abortTransaction();
      const e = new Error('Invalid destination column');
      e.statusCode = 400;
      throw e;
    }

    const sourceCol = await BoardColumn.findById(task.columnId).session(session);
    const sourceWasDone = sourceCol ? isDoneLikeColumnName(sourceCol.name) : false;
    const destIsDone = isDoneLikeColumnName(destCol.name);

    const now = new Date();
    const status = columnNameToTaskStatus(destCol.name);

    if (String(task.columnId) === String(destinationColumnId)) {
      const siblings = await BoardTask.find({ columnId: task.columnId })
        .sort({ order: 1 })
        .session(session);
      const ids = siblings.map((t) => String(t._id));
      const from = ids.indexOf(String(task._id));
      if (from === -1) {
        await session.abortTransaction();
        const e = new Error('Task not in column');
        e.statusCode = 400;
        throw e;
      }
      const next = [...ids];
      next.splice(from, 1);
      const at = Math.min(newOrder, next.length);
      next.splice(at, 0, String(task._id));
      for (let i = 0; i < next.length; i += 1) {
        await BoardTask.updateOne(
          { _id: next[i] },
          { $set: { order: i, status, updatedAt: now } },
          { session },
        );
      }
    } else {
      const sourceSiblings = await BoardTask.find({
        columnId: task.columnId,
        _id: { $ne: task._id },
      })
        .sort({ order: 1 })
        .session(session);
      for (let i = 0; i < sourceSiblings.length; i += 1) {
        await BoardTask.updateOne(
          { _id: sourceSiblings[i]._id },
          { $set: { order: i, updatedAt: now } },
          { session },
        );
      }

      const destSiblings = await BoardTask.find({
        columnId: destinationColumnId,
        _id: { $ne: task._id },
      })
        .sort({ order: 1 })
        .session(session);
      const destIds = destSiblings.map((t) => String(t._id));
      const at = Math.min(newOrder, destIds.length);
      destIds.splice(at, 0, String(task._id));

      await BoardTask.updateOne(
        { _id: task._id },
        {
          $set: {
            columnId: destinationColumnId,
            status,
            updatedAt: now,
          },
        },
        { session },
      );
      for (let i = 0; i < destIds.length; i += 1) {
        await BoardTask.updateOne(
          { _id: destIds[i] },
          { $set: { order: i, status, updatedAt: now } },
          { session },
        );
      }
    }

    if (task.ticketId) {
      const mapped = columnNameToTicketStatus(destCol.name);
      if (mapped) {
        await Ticket.updateOne(
          { _id: task.ticketId },
          { $set: { status: mapped, updatedAt: now } },
          { session },
        );
      }
    }

    await session.commitTransaction();

    const enteredDoneColumn = !sourceWasDone && destIsDone;
    if (enteredDoneColumn) {
      const board = await Board.findById(task.boardId).lean();
      const fresh = await BoardTask.findById(taskId)
        .populate('ticketId', 'ticketId title')
        .populate('assignedTo', 'name')
        .lean();
      const mappedTicketStatus = columnNameToTicketStatus(destCol.name);
      const isTicketCompleted = mappedTicketStatus === 'completed';

      const toSet = new Set();
      if (board?.notifyOnCompleteUsers?.length) {
        const users = await User.find({ _id: { $in: board.notifyOnCompleteUsers } })
          .select('email')
          .lean();
        for (const u of users) {
          const e = u.email?.trim().toLowerCase();
          if (e) toSet.add(e);
        }
      }

      if (task.ticketId && isTicketCompleted) {
        const ctx = await getTicketCompletionMailContext(task.ticketId);
        for (const e of ctx.to) toSet.add(e);
        const to = [...toSet];
        await sendTicketCompletedEmails({
          to,
          ticketRef: ctx.ticketRef,
          title: ctx.title || String(fresh?.title || ''),
          locationName: ctx.locationName,
        });
      } else if (board?.notifyOnCompleteUsers?.length) {
        const to = [...toSet];
        let ticketRef = null;
        if (fresh?.ticketId && typeof fresh.ticketId === 'object' && fresh.ticketId.ticketId != null) {
          ticketRef = String(fresh.ticketId.ticketId);
        }
        const assigneeName =
          fresh?.assignedTo && typeof fresh.assignedTo === 'object' && fresh.assignedTo.name != null
            ? String(fresh.assignedTo.name).trim()
            : '';
        await sendTaskCompleteEmails({
          to,
          taskTitle: String(fresh?.title || ''),
          ticketCode: ticketRef,
          boardName: String(board.name),
          boardId: String(task.boardId),
          taskId: String(taskId),
          assigneeName: assigneeName || null,
        });
      }
    }

    return { ok: true };
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}
