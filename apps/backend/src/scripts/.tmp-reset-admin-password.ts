import { Modules } from "@medusajs/framework/utils"

type ExecArgs = {
  container: {
    resolve: (name: string) => any
  }
}

export default async function run({ container }: ExecArgs) {
  const authModule = container.resolve(Modules.AUTH)
  const email = "nagy.viktordp@gmail.com"
  const password = "Karategi123"

  await authModule.updateProvider("emailpass", { entity_id: email }, { password })
  console.log(`Password updated for ${email}`)
}
