import 'dotenv/config';
import { connectDb } from '../src/config/db.js';
import OnboardingConfig from '../src/models/OnboardingConfig.js';
import OnboardingServiceOption from '../src/models/OnboardingServiceOption.js';
import {
  DEFAULT_ONBOARDING_CONFIG,
  DEFAULT_ONBOARDING_SERVICES,
} from '../src/constants/onboardingDefaults.js';

async function seedOnboarding() {
  await connectDb();

  const { stepSubtitles, ...configFields } = DEFAULT_ONBOARDING_CONFIG;
  await OnboardingConfig.findOneAndUpdate(
    { key: 'default' },
    {
      $set: {
        ...configFields,
        stepSubtitles: new Map(Object.entries(stepSubtitles)),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  for (const service of DEFAULT_ONBOARDING_SERVICES) {
    await OnboardingServiceOption.findOneAndUpdate(
      { slug: service.slug },
      { $set: { ...service, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `Onboarding seeded: 1 config, ${DEFAULT_ONBOARDING_SERVICES.length} service options.`,
  );
  process.exit(0);
}

seedOnboarding().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Onboarding seed failed', err);
  process.exit(1);
});
