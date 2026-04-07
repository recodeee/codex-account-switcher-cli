import { getMedusaRuntimeConfig } from "@/lib/medusa/config";
import { medusaStoreFetch } from "@/lib/medusa/client";

type StoreRegionCountry = {
  iso_2?: string | null;
};

type StoreRegion = {
  id?: string | null;
  name?: string | null;
  currency_code?: string | null;
  countries?: StoreRegionCountry[] | null;
};

type StoreRegionsResponse = {
  regions?: StoreRegion[] | null;
};

export type MedusaRegionSummary = {
  id: string;
  name: string;
  currencyCode: string | null;
  countryCodes: string[];
};

export type MedusaConnectionSnapshot = {
  backendUrl: string;
  publishableKeyConfigured: boolean;
  regions: MedusaRegionSummary[];
};

function normalizeRegion(region: StoreRegion, index: number): MedusaRegionSummary {
  const regionId = region.id?.trim() || `region-${index + 1}`;
  const regionName = region.name?.trim() || regionId;
  const countryCodes = (region.countries ?? [])
    .map((country) => country.iso_2?.trim().toUpperCase())
    .filter((country): country is string => Boolean(country));

  return {
    id: regionId,
    name: regionName,
    currencyCode: region.currency_code?.trim().toUpperCase() || null,
    countryCodes,
  };
}

export async function getMedusaConnectionSnapshot(): Promise<MedusaConnectionSnapshot> {
  const runtime = getMedusaRuntimeConfig();
  let response: StoreRegionsResponse;
  try {
    response = await medusaStoreFetch<StoreRegionsResponse>("/regions");
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to fetch ${runtime.backendUrl}/store/regions (${error.message})`,
      );
    }
    throw error;
  }

  const regions = (response.regions ?? []).map((region, index) => normalizeRegion(region, index));

  return {
    backendUrl: runtime.backendUrl,
    publishableKeyConfigured: Boolean(runtime.publishableKey),
    regions,
  };
}
