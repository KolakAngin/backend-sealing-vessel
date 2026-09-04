function faktorial(angka: number): number {
  if (angka < 0 || !Number.isInteger(angka)) {
    throw new Error("Angka harus berupa bilangan bulat non-negatif");
  }

  if (angka === 0 || angka === 1) {
    return 1;
  }

  return angka * faktorial(angka - 1);
}

console.log(faktorial(5));
