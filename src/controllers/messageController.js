import { asyncHandler } from '../utils/asyncHandler.js';
import * as messageService from '../services/messageService.js';
import { sendContactFormEmail } from '../services/boardMailService.js';

export const createMessage = asyncHandler(async (req, res) => {
  const message = await messageService.createMessage(req.user, req.body);
  res.status(201).json({ message });
});

export const listMessages = asyncHandler(async (req, res) => {
  const messages = await messageService.listMessagesForTicket(req.user, req.query.ticketId);
  res.status(200).json({ messages });
});

export const getMessageSummary = asyncHandler(async (req, res) => {
  const summary = await messageService.getMessageSummaryForTicket(req.user, req.query.ticketId);
  res.status(200).json(summary);
});

export const markThreadRead = asyncHandler(async (req, res) => {
  const result = await messageService.markTicketThreadRead(req.user, req.body.ticketId);
  res.status(200).json(result);
});

export const submitContactForm = asyncHandler(async (req, res) => {
  const sent = await sendContactFormEmail(req.body);
  res.status(200).json({
    ok: true,
    message: sent ? 'Message sent to administrator.' : 'Message received.',
  });
});
