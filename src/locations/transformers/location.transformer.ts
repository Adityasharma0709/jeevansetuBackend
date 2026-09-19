export function formatLocationBase(entity: any) {
  if (!entity) return null;

  const blockName = entity.block && typeof entity.block === 'object'
    ? entity.block.name
    : (typeof entity.block === 'string' ? entity.block : null);

  const villageName = entity.village && typeof entity.village === 'object'
    ? entity.village.name
    : (typeof entity.village === 'string' ? entity.village : null);

  const stateName = entity.state && typeof entity.state === 'object'
    ? entity.state.name
    : (typeof entity.state === 'string' ? entity.state : null);

  const districtName = entity.district && typeof entity.district === 'object'
    ? entity.district.name
    : (typeof entity.district === 'string' ? entity.district : null);

  return {
    ...entity,
    stateName: stateName ?? null,
    districtName: districtName ?? null,
    blockName: blockName ?? null,
    villageName: villageName ?? null,
  };
}

export function transformAwc(awc: any) {
  if (!awc) return null;
  const base = formatLocationBase(awc);
  const nameVal = awc.awcName || awc.name || null;
  return {
    ...base,
    awcName: nameVal,
    name: nameVal,
    institutionType: 'AWC',
  };
}

export function transformSchool(school: any) {
  if (!school) return null;
  const base = formatLocationBase(school);
  const nameVal = school.schoolName || school.name || null;
  return {
    ...base,
    schoolName: nameVal,
    name: nameVal,
    institutionType: 'SCHOOL',
  };
}

export function transformHealthCenter(hc: any) {
  if (!hc) return null;
  const base = formatLocationBase(hc);
  const nameVal = hc.healthCenterName || hc.name || null;
  return {
    ...base,
    healthCenterName: nameVal,
    name: nameVal,
    institutionType: 'HEALTH_CENTER',
  };
}
