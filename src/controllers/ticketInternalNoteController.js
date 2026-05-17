import { asyncHandler } from '../utils/asyncHandler.js';
import * as ticketInternalNoteService from '../services/ticketInternalNoteService.js';

export const listInternalNotes = asyncHandler(async (req, res) => {
  const notes = await ticketInternalNoteService.listInternalNotes(req.user, req.params.id);
  res.status(200).json({ notes });
});

export const createInternalNote = asyncHandler(async (req, res) => {
  const note = await ticketInternalNoteService.createInternalNote(req.user, req.params.id, req.body);
  res.status(201).json({ note });
});

export const updateInternalNote = asyncHandler(async (req, res) => {
  const note = await ticketInternalNoteService.updateInternalNote(
    req.user,
    req.params.id,
    req.params.noteId,
    req.body,
  );
  res.status(200).json({ note });
});

export const deleteInternalNote = asyncHandler(async (req, res) => {
  const result = await ticketInternalNoteService.deleteInternalNote(
    req.user,
    req.params.id,
    req.params.noteId,
  );
  res.status(200).json(result);
});
