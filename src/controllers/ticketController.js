import { asyncHandler } from '../utils/asyncHandler.js';
import * as ticketService from '../services/ticketService.js';

export const createTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.createTicket(req.user, req.body);
  res.status(201).json(ticket);
});

export const listTickets = asyncHandler(async (req, res) => {
  const payload = await ticketService.listTickets(req.user, req.query);
  res.status(200).json(payload);
});

export const getTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.getTicketById(req.user, req.params.id);
  res.status(200).json(ticket);
});

export const updateTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.updateTicket(req.user, req.params.id, req.body);
  res.status(200).json(ticket);
});

export const deleteTicket = asyncHandler(async (req, res) => {
  const result = await ticketService.deleteTicket(req.user, req.params.id);
  res.status(200).json(result);
});

export const bulkUpdateTickets = asyncHandler(async (req, res) => {
  const result = await ticketService.bulkUpdateTickets(req.user, req.body);
  res.status(200).json(result);
});

export const bulkDeleteTickets = asyncHandler(async (req, res) => {
  const result = await ticketService.bulkDeleteTickets(req.user, req.body);
  res.status(200).json(result);
});
