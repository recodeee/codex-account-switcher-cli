import { defineWidgetConfig } from "@medusajs/admin-sdk"

import recodeeLogo from "../assets/recodee-logo.svg"

const avatarSelector =
  "div[class*='bg-ui-button-neutral'][class*='shadow-buttons-neutral'][class*='after:button-neutral-gradient']"

const LoginBrandingStyleWidget = () => {
  return (
    <style>{`
      /* IconAvatar wraps children in an inner div, so target that node */
      ${avatarSelector} > div {
        background-image: url("${recodeeLogo}");
        background-position: center;
        background-repeat: no-repeat;
        background-size: 34px 28px;
      }

      ${avatarSelector} > div > svg {
        display: none !important;
      }
    `}</style>
  )
}

export const config = defineWidgetConfig({
  zone: "login.before",
})

export default LoginBrandingStyleWidget
