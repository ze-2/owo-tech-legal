export const sctGroups = Object.freeze([
  {
    id: "goods",
    label: "CONTRACT FOR SALE OF GOODS",
    options: [
      "Defective Goods",
      "Non-Delivery",
      "Goods Not As Contracted",
      "Non-Payment",
      "Cancellation/Opt Out",
      "Refund (motor vehicle deposit)",
      "Unfair Practice in relation to Hire Purchase Agreements",
      "Others",
    ],
  },
  {
    id: "services",
    label: "CONTRACT FOR PROVISION OF SERVICES",
    options: [
      "Unsatisfactory Services",
      "Incomplete Services",
      "Renovation Services",
      "No Services Rendered",
      "Non-Payment",
      "Others",
    ],
  },
  {
    id: "property",
    label: "DAMAGE TO PROPERTY",
    options: [
      "Owner of Property",
      "Damage not arising from motor vehicle accident",
      "Others",
    ],
  },
  {
    id: "residential",
    label: "LEASE NOT EXCEEDING 2 YEARS (RESIDENTIAL PREMISES)",
    options: [
      "Breach of Tenant's Obligation",
      "Breach of Landlord's Obligation",
      "Refund of Rental Deposit",
      "Rental Arrears",
      "Others",
    ],
  },
]);

const recommendations = Object.freeze({
  "Sale of goods": { groupId: "goods" },
  "Provision of services": { groupId: "services" },
  "Residential tenancy": { groupId: "residential" },
  "Property damage": { groupId: "property" },
  "Unfair practice": { groupId: "goods" },
  "Motor vehicle deposit": {
    groupId: "goods",
    option: "Refund (motor vehicle deposit)",
  },
});

export function optionId(groupId, label) {
  const group = sctGroups.find((entry) => entry.id === groupId);
  const index = group?.options.indexOf(label) ?? -1;
  return index < 0 ? "" : `${groupId}:${index}`;
}

export function claimTypeRecommendation(claimType) {
  return recommendations[claimType] ?? null;
}
