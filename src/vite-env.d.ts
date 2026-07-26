/// <reference types="vite/client" />

// Vite's ambient types, chiefly `import.meta.env`. Added when the code started
// reading `import.meta.env.BASE_URL` to build in-app URLs -- without this the
// build typechecks fine right up until `tsc` sees it, and then fails with
// "Property 'env' does not exist on type 'ImportMeta'".
