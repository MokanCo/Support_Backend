import { asyncHandler } from '../utils/asyncHandler.js';
import * as onboardingService from '../services/onboardingService.js';

export const getConfig = asyncHandler(async (_req, res) => {
  const result = await onboardingService.getPublicConfig();
  res.status(200).json(result);
});

export const updateConfig = asyncHandler(async (req, res) => {
  const result = await onboardingService.updateConfig(req.body);
  res.status(200).json(result);
});

export const listServices = asyncHandler(async (_req, res) => {
  const result = await onboardingService.listPublicServices();
  res.status(200).json(result);
});

export const listAllServices = asyncHandler(async (_req, res) => {
  const result = await onboardingService.listAllServices();
  res.status(200).json(result);
});

export const createService = asyncHandler(async (req, res) => {
  const result = await onboardingService.createServiceOption(req.body);
  res.status(201).json(result);
});

export const updateService = asyncHandler(async (req, res) => {
  const result = await onboardingService.updateServiceOption(req.params.id, req.body);
  res.status(200).json(result);
});

export const deleteService = asyncHandler(async (req, res) => {
  const result = await onboardingService.deleteServiceOption(req.params.id);
  res.status(200).json(result);
});

export const submitRequest = asyncHandler(async (req, res) => {
  const result = await onboardingService.submitOnboardingRequest(req.body);
  res.status(201).json(result);
});

export const createDraft = asyncHandler(async (req, res) => {
  const result = await onboardingService.createOrUpdateDraftRequest(req.body);
  res.status(201).json(result);
});

export const updateDraftServices = asyncHandler(async (req, res) => {
  const result = await onboardingService.updateDraftServices(
    req.params.token,
    req.body.selectedServices,
  );
  res.status(200).json(result);
});

export const finalizeRequest = asyncHandler(async (req, res) => {
  const result = await onboardingService.finalizeOnboardingRequest(req.params.token);
  res.status(200).json(result);
});

export const trackRequest = asyncHandler(async (req, res) => {
  const result = await onboardingService.trackOnboardingRequest(req.params.token);
  res.status(200).json(result);
});

export const listRequests = asyncHandler(async (req, res) => {
  const result = await onboardingService.listOnboardingRequests(req.query);
  res.status(200).json(result);
});

export const getRequest = asyncHandler(async (req, res) => {
  const result = await onboardingService.getOnboardingRequestById(req.params.id);
  res.status(200).json(result);
});

export const reviewRequest = asyncHandler(async (req, res) => {
  const result = await onboardingService.reviewOnboardingRequest(
    req.params.id,
    req.body,
    req.user,
  );
  res.status(200).json(result);
});

export const approveRequest = asyncHandler(async (req, res) => {
  const { approveRequest: approve } = await import('../services/onboardingManagementService.js');
  const result = await approve(req.params.id, req.user);
  res.status(200).json(result);
});

export const rejectRequest = asyncHandler(async (req, res) => {
  const { rejectRequest: reject } = await import('../services/onboardingManagementService.js');
  const result = await reject(req.params.id, req.user, req.body.reviewNotes);
  res.status(200).json(result);
});

export const updateTask = asyncHandler(async (req, res) => {
  const { updateRequestTask } = await import('../services/onboardingManagementService.js');
  const result = await updateRequestTask(
    req.params.id,
    req.params.taskId,
    req.body,
    req.user,
  );
  res.status(200).json(result);
});

export const provisionRequest = asyncHandler(async (req, res) => {
  const { provisionRequest: provision } = await import('../services/onboardingManagementService.js');
  const result = await provision(req.params.id, req.user);
  res.status(200).json(result);
});

export const notifyEmailConflict = asyncHandler(async (req, res) => {
  const { notifyEmailConflict: notify } = await import('../services/onboardingManagementService.js');
  const result = await notify(req.params.id);
  res.status(200).json(result);
});

export const checkEmail = asyncHandler(async (req, res) => {
  const { checkEmailAvailability } = await import('../services/onboardingManagementService.js');
  const result = await checkEmailAvailability(req.query.email);
  res.status(200).json(result);
});

export const syncTemplates = asyncHandler(async (_req, res) => {
  const { syncServiceTemplates } = await import('../services/onboardingTemplateService.js');
  const result = await syncServiceTemplates();
  res.status(200).json(result);
});

export const listPublicChatMessages = asyncHandler(async (req, res) => {
  const { listMessagesForToken } = await import('../services/onboardingChatService.js');
  const result = await listMessagesForToken(req.params.token);
  res.status(200).json(result);
});

export const createPublicChatMessage = asyncHandler(async (req, res) => {
  const { createCustomerMessage } = await import('../services/onboardingChatService.js');
  const result = await createCustomerMessage(req.params.token, req.body.text);
  res.status(201).json(result);
});

export const listAdminChatMessages = asyncHandler(async (req, res) => {
  const { listMessagesForAdmin } = await import('../services/onboardingChatService.js');
  const result = await listMessagesForAdmin(req.params.id);
  res.status(200).json(result);
});

export const createAdminChatMessage = asyncHandler(async (req, res) => {
  const { createAdminMessage } = await import('../services/onboardingChatService.js');
  const result = await createAdminMessage(req.params.id, req.user, req.body.text);
  res.status(201).json(result);
});
