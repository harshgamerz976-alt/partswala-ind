export const SHIPPING_CONFIG = {
	codFixedFee: 0,
	codPercentage: 0,
	volumetricDivisor: 5000,
};

function positiveNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : 0;
}

export function getChargeableWeight({ weight = 0, length, width, height, volumetricWeight }) {
	const actualWeight = positiveNumber(weight);
	const dimensions = [length, width, height].map(positiveNumber);
	const hasDimensions = dimensions.every(Boolean);
	const calculatedVolumetricWeight = hasDimensions ? dimensions.reduce((total, value) => total * value, 1) / SHIPPING_CONFIG.volumetricDivisor : 0;
	const finalVolumetricWeight = Number.isFinite(Number(volumetricWeight)) ? Number(volumetricWeight) : calculatedVolumetricWeight;
	return {
		actualWeight,
		volumetricWeight: finalVolumetricWeight,
		chargeableWeight: Math.max(actualWeight, finalVolumetricWeight),
		hasDimensions,
	};
}

export function calculateShippingEstimate({ pickupPincode = "", deliveryPincode = "", totalWeight, weight = 0, dimensions = {}, length, width, height, volumetricWeight, paymentMethod = "COD", orderValue = 0 } = {}) {
	const shipment = getChargeableWeight({
		weight: totalWeight ?? weight,
		length: dimensions.length ?? length,
		width: dimensions.width ?? width,
		height: dimensions.height ?? height,
		volumetricWeight,
	});
	return {
		...shipment,
		amount: null,
		isEstimate: false,
		available: false,
		message: shipment.chargeableWeight > 0 ? "Calculated at checkout" : "Shipping unavailable",
		pickupPincode: String(pickupPincode || "").trim(),
		deliveryPincode: String(deliveryPincode || "").trim(),
		paymentMethod,
		orderValue: positiveNumber(orderValue),
	};
}

export function calculateShipmentEstimate(items, options = {}) {
	const totals = items.reduce((result, item) => {
		const quantity = Math.max(1, Number(item.quantity) || 1);
		const product = getChargeableWeight(item.product || item);
		result.actualWeight += product.actualWeight * quantity;
		result.volumetricWeight += product.volumetricWeight * quantity;
		return result;
	}, { actualWeight: 0, volumetricWeight: 0 });
	return calculateShippingEstimate({ ...options, totalWeight: totals.actualWeight, volumetricWeight: totals.volumetricWeight });
}

export function calculateCodFee(orderValue, settings = {}) {
	const fixedFee = Number(settings.codFixedFee ?? SHIPPING_CONFIG.codFixedFee) || 0;
	const percentage = Number(settings.codPercentage ?? SHIPPING_CONFIG.codPercentage) || 0;
	return Number((fixedFee + Math.max(0, Number(orderValue) || 0) * percentage / 100).toFixed(2));
}

export async function createShipment(_order, _shippingInfo) { console.log("Delhivery integration requires backend"); }
export async function trackShipment(_waybill) { console.log("Delhivery tracking requires backend"); }