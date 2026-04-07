import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
  createDefaultsWorkflow,
} from "@medusajs/medusa/core-flows";

export default async function initialSeed({ container }: ExecArgs) {
  if (process.env.SKIP_INITIAL_SEED === "true") {
    return;
  }

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService = container.resolve(Modules.STORE);
  const productModuleService = container.resolve(Modules.PRODUCT);

  // Skip if already seeded
  const existingProducts = await productModuleService.listProducts({}, { take: 1 });
  if (existingProducts.length > 0) {
    const [existingStore] = await storeModuleService.listStores();

    if (existingStore?.id) {
      await updateStoresWorkflow(container).run({
        input: {
          selector: { id: existingStore.id },
          update: {
            name: "WEBU",
          },
        },
      });
    }

    logger.info("Initial seed already applied, skipping.");
    return;
  }

  logger.info("Seeding defaults...");
  await createDefaultsWorkflow(container).run();

  const storefrontCountries = ["hu", "sk"];

  // ---------------------------------------------------------------------------
  // Store + Sales Channel
  // ---------------------------------------------------------------------------
  logger.info("Seeding store data...");
  const [store] = await storeModuleService.listStores();

  if (store?.id) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          name: "WEBU",
        },
      },
    });
  }

  let defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  });

  if (!defaultSalesChannel.length) {
    const { result: salesChannelResult } = await createSalesChannelsWorkflow(
      container
    ).run({
      input: {
        salesChannelsData: [{ name: "Default Sales Channel" }],
      },
    });
    defaultSalesChannel = salesChannelResult;
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: pricePreferences } = await query.graph({
    entity: "price_preference",
    fields: ["id"],
  });

  if (pricePreferences.length > 0) {
    const ids = pricePreferences.map((pp: { id: string }) => pp.id);
    await container.resolve(Modules.PRICING).deletePricePreferences(ids);
  }

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        name: "WEBU",
        supported_currencies: [
          { currency_code: "eur", is_default: true, is_tax_inclusive: true },
        ],
        default_sales_channel_id: defaultSalesChannel[0].id,
      },
    },
  });

  // ---------------------------------------------------------------------------
  // Regions
  // ---------------------------------------------------------------------------
  logger.info("Seeding region data...");
  const { result: regionResult } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "HU-SK",
          currency_code: "eur",
          countries: storefrontCountries,
          payment_providers: ["pp_system_default"],
          automatic_taxes: true,
          is_tax_inclusive: true,
        },
      ],
    },
  });
  logger.info("Finished seeding regions.");

  // ---------------------------------------------------------------------------
  // Tax regions
  // ---------------------------------------------------------------------------
  logger.info("Seeding tax regions...");
  const taxRates: Record<string, { rate: number; code: string; name: string }> =
    {
      hu: { rate: 27, code: "HU27", name: "Hungary VAT" },
      sk: { rate: 20, code: "SK20", name: "Slovakia VAT" },
    };

  await createTaxRegionsWorkflow(container).run({
    input: storefrontCountries.map((country_code) => {
      const taxConfig = taxRates[country_code];
      return {
        country_code,
        provider_id: "tp_system",
        default_tax_rate: {
          rate: taxConfig.rate,
          code: taxConfig.code,
          name: taxConfig.name,
          is_default: true,
        },
      };
    }),
  });
  logger.info("Finished seeding tax regions.");

  // ---------------------------------------------------------------------------
  // Stock location + fulfillment
  // ---------------------------------------------------------------------------
  logger.info("Seeding stock location data...");
  const { result: stockLocationResult } = await createStockLocationsWorkflow(
    container
  ).run({
    input: {
      locations: [
        {
          name: "Main Warehouse",
          address: {
            city: "",
            country_code: "HU",
            address_1: "",
          },
        },
      ],
    },
  });
  const stockLocation = stockLocationResult[0];

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_provider_id: "manual_manual",
    },
  });

  logger.info("Seeding fulfillment data...");
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  });
  let shippingProfile = shippingProfiles.length ? shippingProfiles[0] : null;

  if (!shippingProfile) {
    const { result: shippingProfileResult } =
      await createShippingProfilesWorkflow(container).run({
        input: {
          data: [{ name: "Default Shipping Profile", type: "default" }],
        },
      });
    shippingProfile = shippingProfileResult[0];
  }

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
        name: "Main Warehouse Delivery",
        type: "shipping",
        service_zones: [
          {
            name: "HU-SK",
            geo_zones: storefrontCountries.map((country_code) => ({
              country_code,
              type: "country" as const,
            })),
      },
    ],
  });

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_set_id: fulfillmentSet.id,
    },
  });

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Standard Worldwide Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Standard",
          description: "Ships worldwide",
          code: "standard-worldwide",
        },
        prices: [
          { currency_code: "eur", amount: 10 },
        ],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
    ],
  });
  logger.info("Finished seeding fulfillment data.");

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [defaultSalesChannel[0].id],
    },
  });
  logger.info("Finished seeding stock location data.");

  // ---------------------------------------------------------------------------
  // Publishable API key
  // ---------------------------------------------------------------------------
  logger.info("Seeding publishable API key data...");
  const { result: publishableApiKeyResult } = await createApiKeysWorkflow(
    container
  ).run({
    input: {
      api_keys: [
        {
          title: "Webshop",
          type: "publishable",
          created_by: "",
        },
      ],
    },
  });
  const publishableApiKey = publishableApiKeyResult[0];

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableApiKey.id,
      add: [defaultSalesChannel[0].id],
    },
  });
  logger.info("Finished seeding publishable API key data.");

  // ---------------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------------
  logger.info("Seeding product data...");
  await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Coffee Beans Bag",
          handle: "coffee-beans-single",
          subtitle: "350g of premium single-origin coffee",
          description:
            "A single bag of our premium single-origin coffee beans. Carefully roasted to bring out rich, complex flavors with notes of chocolate, caramel, and citrus.",
          status: "published" as const,
          thumbnail:
            "https://cdn.mignite.app/ws/works_01KG7HEF506FB5P7HQP4V3WMR7/3c6ca128-845c-4845-8b00-d8b08e4166d0-01KGHYTH366QXK9S2ZFTJKZSXE.png",
          images: [
            {
              url: "https://cdn.mignite.app/ws/works_01KG7HEF506FB5P7HQP4V3WMR7/3c6ca128-845c-4845-8b00-d8b08e4166d0-01KGHYTH366QXK9S2ZFTJKZSXE.png",
            },
          ],
          metadata: {
            carbs: "25g",
            servings: "10",
            ingredients: "Maple Sap, Sea Salt",
          },
          discountable: true,
          options: [{ title: "Default option", values: ["Default option value"] }],
          variants: [
            {
              title: "1 x Bag",
              sku: "SAP-25G-CASE",
              allow_backorder: false,
              manage_inventory: false,
              options: { "Default option": "Default option value" },
              prices: [
                { currency_code: "usd", amount: 15 },
                { currency_code: "eur", amount: 13.5 },
              ],
            },
          ],
          sales_channels: [{ id: defaultSalesChannel[0].id }],
        },
        {
          title: "Coffee Beans Box",
          handle: "coffee-beans-sample",
          subtitle: "5 bags of premium single-origin coffee",
          description:
            "A box containing 5 bags of our premium single-origin coffee beans. Perfect for stocking up or sharing with friends. Each bag is 350g of carefully roasted beans.",
          status: "published" as const,
          thumbnail:
            "https://cdn.mignite.app/ws/works_01KG7HEF506FB5P7HQP4V3WMR7/generated-01KH3ZYDEKH0X7Z30CGTESFWXD-01KH3ZYDEKJXP4E9MCKK7X46NK.jpeg",
          images: [
            {
              url: "https://cdn.mignite.app/ws/works_01KG7HEF506FB5P7HQP4V3WMR7/generated-01KH3ZYDEKH0X7Z30CGTESFWXD-01KH3ZYDEKJXP4E9MCKK7X46NK.jpeg",
            },
          ],
          metadata: {
            carbs: "25g",
            servings: "3",
            ingredients: "Maple Sap, Sea Salt",
          },
          discountable: true,
          options: [{ title: "Default option", values: ["Default option value"] }],
          variants: [
            {
              title: "5 x Bags",
              sku: "SAP-25G-SAMPLE",
              allow_backorder: false,
              manage_inventory: false,
              options: { "Default option": "Default option value" },
              prices: [
                { currency_code: "usd", amount: 63.75 },
                { currency_code: "eur", amount: 57.38 },
              ],
            },
          ],
          sales_channels: [{ id: defaultSalesChannel[0].id }],
        },
      ],
    },
  });
  logger.info("Finished seeding product data.");

  logger.info("Initial seed complete.");
}
