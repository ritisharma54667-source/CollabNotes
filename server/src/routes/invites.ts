import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { acceptInvite, previewInvite } from '../documents.js';
import { asyncHandler, idParam, parse } from '../http.js';

export const invitesRouter = Router();
invitesRouter.use(requireAuth);

invitesRouter.get('/:token', asyncHandler(async (req, res) => {
  res.json({ invite: await previewInvite(parse(idParam, req.params.token)) });
}));

invitesRouter.post('/:token/accept', asyncHandler(async (req, res) => {
  res.json(await acceptInvite(parse(idParam, req.params.token), req.user!.id));
}));
