export async function collectPageErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    return errors;
}
