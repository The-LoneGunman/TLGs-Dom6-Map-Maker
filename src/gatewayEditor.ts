import type { GateLink, Plane, Province } from "./domain";

/** Return the real project gateways that have at least one endpoint on a plane. */
export function gatesTouchingPlane(gates: readonly GateLink[], planeId: string): GateLink[] {
  return gates.filter((gate) => gate.endpoints.some((endpoint) => endpoint.planeId === planeId));
}

/** Resolve the user-facing, plane-local province number to its stable project ID. */
export function provinceAtLocalIndex(
  plane: Pick<Plane, "provinces">,
  localIndex: number,
): Province | undefined {
  if (!Number.isSafeInteger(localIndex) || localIndex < 1) return undefined;
  return plane.provinces.find((province) => province.index === localIndex);
}

/** Gate numbers are positive safe integers and identify exactly one editor group. */
export function gateNumberIsAvailable(
  gates: readonly GateLink[],
  gateId: string,
  gateNumber: number,
): boolean {
  return Number.isSafeInteger(gateNumber)
    && gateNumber > 0
    && !gates.some((gate) => gate.id !== gateId && gate.gateNumber === gateNumber);
}

/** A province may appear only once within the same shared gateway group. */
export function gateEndpointIsUsed(
  gate: GateLink,
  planeId: string,
  provinceId: string,
  exceptEndpointIndex: number,
): boolean {
  return gate.endpoints.some((endpoint, index) => index !== exceptEndpointIndex
    && endpoint.planeId === planeId
    && endpoint.provinceId === provinceId);
}

/** Remove one plane's endpoints while retaining groups that still connect 2+ endpoints. */
export function withoutPlaneGateEndpoints(
  gates: readonly GateLink[],
  planeId: string,
): GateLink[] {
  return gates.flatMap((gate) => {
    const endpoints = gate.endpoints.filter((endpoint) => endpoint.planeId !== planeId);
    if (endpoints.length === gate.endpoints.length) return [gate];
    return endpoints.length >= 2 ? [{ ...gate, endpoints }] : [];
  });
}
