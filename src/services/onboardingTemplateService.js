import OnboardingServiceTemplate from '../models/OnboardingServiceTemplate.js';
import OnboardingTaskTemplate from '../models/OnboardingTaskTemplate.js';
import OnboardingRequestTask from '../models/OnboardingRequestTask.js';
import OnboardingServiceOption from '../models/OnboardingServiceOption.js';
import { ONBOARDING_SERVICE_TEMPLATE_DEFS } from '../data/onboardingServiceTemplates.js';

export const ONBOARDING_SECTION_ORDER = [
  'Business Listings',
  'Website Listing',
  'Delivery Services',
];

export async function getActiveServiceMetaMap() {
  const services = await OnboardingServiceTemplate.find({ isActive: true }).lean();
  return new Map(services.map((s) => [s.slug, s]));
}

export function groupServicesBySection(flatServices) {
  const bySection = new Map();
  for (const svc of flatServices) {
    const sectionTitle = svc.section || 'Other';
    if (!bySection.has(sectionTitle)) {
      bySection.set(sectionTitle, { title: sectionTitle, services: [] });
    }
    bySection.get(sectionTitle).services.push(svc);
  }
  const sections = [...bySection.values()];
  sections.sort((a, b) => {
    const ai = ONBOARDING_SECTION_ORDER.indexOf(a.title);
    const bi = ONBOARDING_SECTION_ORDER.indexOf(b.title);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  for (const sec of sections) {
    sec.services.sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0));
  }
  return sections;
}

export function buildServiceGroupsFromTasks(tasks, metaMap, formatTask) {
  const servicesMap = new Map();
  for (const task of tasks) {
    if (!servicesMap.has(task.serviceSlug)) {
      const meta = metaMap.get(task.serviceSlug);
      servicesMap.set(task.serviceSlug, {
        slug: task.serviceSlug,
        title: meta?.title ?? task.serviceTitle,
        section: meta?.section ?? 'Other',
        sortOrder: meta?.sortOrder ?? 0,
        iconKey: meta?.iconKey ?? 'globe',
        iconClass: meta?.iconClass ?? '',
        tasks: [],
      });
    }
    servicesMap.get(task.serviceSlug).tasks.push(formatTask(task));
  }
  const services = [...servicesMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    services,
    serviceSections: groupServicesBySection(services),
  };
}

export async function buildPreviewServiceGroups(selectedSlugs, metaMap) {
  const slugs = [...new Set(
    (selectedSlugs || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean),
  )].filter((slug) => metaMap.has(slug));
  if (slugs.length === 0) {
    return { services: [], serviceSections: [] };
  }

  const templates = await OnboardingTaskTemplate.find({ serviceSlug: { $in: slugs } })
    .sort({ serviceSlug: 1, sortOrder: 1 })
    .lean();

  const servicesMap = new Map();
  for (const tpl of templates) {
    if (!servicesMap.has(tpl.serviceSlug)) {
      const meta = metaMap.get(tpl.serviceSlug);
      servicesMap.set(tpl.serviceSlug, {
        slug: tpl.serviceSlug,
        title: meta?.title ?? tpl.serviceSlug,
        section: meta?.section ?? 'Other',
        sortOrder: meta?.sortOrder ?? 0,
        iconKey: meta?.iconKey ?? 'globe',
        iconClass: meta?.iconClass ?? '',
        tasks: [],
      });
    }
    servicesMap.get(tpl.serviceSlug).tasks.push({
      id: `preview-${tpl.serviceSlug}-${tpl.sortOrder}`,
      serviceSlug: tpl.serviceSlug,
      serviceTitle: metaMap.get(tpl.serviceSlug)?.title ?? tpl.serviceSlug,
      title: tpl.title,
      sortOrder: tpl.sortOrder,
      completed: false,
      completedAt: null,
      completedByName: '',
      publicComment: '',
      internalNote: '',
      issueDescription: '',
      resolution: '',
      attachmentUrl: '',
      isPreview: true,
    });
  }

  const services = [...servicesMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    services,
    serviceSections: groupServicesBySection(services),
  };
}

/**
 * Align persisted request tasks with the current template definitions.
 * Preserves completion state and comments when task titles still match.
 */
export async function reconcileRequestTasks(requestId, selectedSlugs) {
  const metaMap = await getActiveServiceMetaMap();
  const slugs = [...new Set(
    (selectedSlugs || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean),
  )].filter((slug) => metaMap.has(slug));
  if (slugs.length === 0) {
    await OnboardingRequestTask.deleteMany({ requestId });
    return 0;
  }

  const [templates, existing] = await Promise.all([
    OnboardingTaskTemplate.find({ serviceSlug: { $in: slugs } })
      .sort({ serviceSlug: 1, sortOrder: 1 })
      .lean(),
    OnboardingRequestTask.find({ requestId }).lean(),
  ]);

  const preserve = new Map();
  for (const t of existing) {
    preserve.set(`${t.serviceSlug}::${t.title}`, t);
  }

  await OnboardingRequestTask.deleteMany({ requestId });

  const docs = templates.map((tpl) => {
    const meta = metaMap.get(tpl.serviceSlug);
    const prev = preserve.get(`${tpl.serviceSlug}::${tpl.title}`);
    return {
      requestId,
      serviceSlug: tpl.serviceSlug,
      serviceTitle: meta?.title ?? tpl.serviceSlug,
      taskTemplateId: tpl._id,
      title: tpl.title,
      sortOrder: tpl.sortOrder,
      completed: Boolean(prev?.completed),
      completedAt: prev?.completedAt ?? null,
      completedBy: prev?.completedBy ?? null,
      completedByName: prev?.completedByName ?? '',
      publicComment: prev?.publicComment ?? '',
      internalNote: prev?.internalNote ?? '',
      issueDescription: prev?.issueDescription ?? '',
      resolution: prev?.resolution ?? '',
      attachmentUrl: prev?.attachmentUrl ?? '',
    };
  });

  if (docs.length > 0) {
    await OnboardingRequestTask.insertMany(docs);
  }
  return docs.length;
}

export async function syncServiceTemplates() {
  const activeSlugs = ONBOARDING_SERVICE_TEMPLATE_DEFS.map((d) => d.slug);
  const results = [];

  for (const def of ONBOARDING_SERVICE_TEMPLATE_DEFS) {
    const service = await OnboardingServiceTemplate.findOneAndUpdate(
      { slug: def.slug },
      {
        $set: {
          title: def.title,
          section: def.section,
          iconKey: def.iconKey,
          iconClass: def.iconClass,
          sortOrder: def.sortOrder,
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await OnboardingServiceOption.findOneAndUpdate(
      { slug: def.slug },
      {
        $set: {
          title: def.title,
          section: def.section,
          iconKey: def.iconKey,
          iconClass: def.iconClass,
          sortOrder: def.sortOrder,
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    for (let i = 0; i < def.tasks.length; i += 1) {
      const title = def.tasks[i];
      // eslint-disable-next-line no-await-in-loop
      await OnboardingTaskTemplate.findOneAndUpdate(
        { serviceSlug: def.slug, title },
        {
          $set: {
            serviceTemplateId: service._id,
            sortOrder: i,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    await OnboardingTaskTemplate.deleteMany({
      serviceSlug: def.slug,
      title: { $nin: def.tasks },
    });

    results.push({ slug: def.slug, title: def.title, taskCount: def.tasks.length });
  }

  await OnboardingServiceTemplate.updateMany(
    { slug: { $nin: activeSlugs } },
    { $set: { isActive: false } },
  );
  await OnboardingServiceOption.updateMany(
    { slug: { $nin: activeSlugs } },
    { $set: { isActive: false } },
  );

  return { synced: results.length, services: results };
}

export async function listServiceTemplates() {
  const services = await OnboardingServiceTemplate.find({ isActive: true })
    .sort({ sortOrder: 1, title: 1 })
    .lean();
  const tasks = await OnboardingTaskTemplate.find()
    .sort({ serviceSlug: 1, sortOrder: 1 })
    .lean();
  const taskMap = new Map();
  for (const t of tasks) {
    if (!taskMap.has(t.serviceSlug)) taskMap.set(t.serviceSlug, []);
    taskMap.get(t.serviceSlug).push(t);
  }
  return {
    templates: services.map((s) => ({
      id: String(s._id),
      slug: s.slug,
      title: s.title,
      section: s.section,
      iconKey: s.iconKey,
      iconClass: s.iconClass,
      tasks: (taskMap.get(s.slug) ?? []).map((t) => ({
        id: String(t._id),
        title: t.title,
        sortOrder: t.sortOrder,
      })),
    })),
  };
}

export async function instantiateRequestTasks(requestId, selectedSlugs) {
  const slugs = [...new Set(selectedSlugs.map((s) => String(s).toLowerCase().trim()))];
  const services = await OnboardingServiceTemplate.find({
    slug: { $in: slugs },
    isActive: true,
  }).lean();
  const templates = await OnboardingTaskTemplate.find({ serviceSlug: { $in: slugs } })
    .sort({ serviceSlug: 1, sortOrder: 1 })
    .lean();

  const serviceTitleBySlug = new Map(services.map((s) => [s.slug, s.title]));
  const docs = templates.map((t) => ({
    requestId,
    serviceSlug: t.serviceSlug,
    serviceTitle: serviceTitleBySlug.get(t.serviceSlug) ?? t.serviceSlug,
    taskTemplateId: t._id,
    title: t.title,
    sortOrder: t.sortOrder,
  }));

  if (docs.length > 0) {
    await OnboardingRequestTask.insertMany(docs);
  }
  return docs.length;
}
