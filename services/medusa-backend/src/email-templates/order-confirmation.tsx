import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Row,
  Column,
  Text,
  Img,
  Hr,
} from "@react-email/components";
import { styles } from "./styles";

interface OrderItem {
  title: string;
  subtitle: string;
  thumbnail: string;
  quantity: number;
  unit_price: number;
  compare_at_unit_price?: number;
  total: number;
}

interface Address {
  first_name: string;
  last_name: string;
  address_1: string;
  address_2?: string;
  postal_code: string;
  city: string;
  country_code: string;
}

interface OrderConfirmationProps {
  displayId: number;
  email: string;
  createdAt: string;
  currencyCode: string;
  items: OrderItem[];
  shippingAddress: Address;
  itemSubtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  total: number;
  paymentStatus: string;
}

export default function OrderConfirmation({
  displayId = 10035,
  email = "test@example.com",
  createdAt = "2025-10-11T08:51:41.106Z",
  currencyCode = "EUR",
  shippingAddress = {
    first_name: "Tony",
    last_name: "Stark",
    address_1: "10880 Malibu Point, 90265",
    address_2: "",
    postal_code: "90265",
    city: "Malibu",
    country_code: "US",
  },
  items = [
    {
      title: "Relaxed Jogger Pant",
      subtitle:
        "Minimalist joggers with a tailored silhouette—ideal for travel or downtime.",
      thumbnail:
        "https://cdn.mignite.app/ws/works_01KGFKTHDC6ZD3WS7GQTX8992N/-NanoBanana-2026-02-05-5-2-01KGSBR3R5A1KXA1MBX09R0YJ1.jpeg",
      quantity: 1,
      unit_price: 50,
      total: 50,
    },
  ],
  itemSubtotal = 50,
  discountTotal = 0,
  shippingTotal = 0,
  taxTotal = 0,
  total = 50,
}: OrderConfirmationProps) {
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section>
            <Text style={styles.heading}>Dear Customer,</Text>
            <Text style={styles.heading}>Thank you for your purchase!</Text>
          </Section>

          <Section>
            <Text style={styles.text}>
              Order number: <strong>{displayId}</strong>
            </Text>
            <Text style={styles.text}>
              Order date: <strong>{formatDate(createdAt)}</strong>
            </Text>
          </Section>

          <Hr style={styles.hr} />

          <Section>
            <Text style={styles.heading}>Order Summary</Text>
            {items.map((item, index) => (
              <Row key={index} style={styles.itemRow}>
                <Column style={styles.itemImageColumn}>
                  <Img
                    src={item.thumbnail}
                    alt={item.title}
                    width="240"
                    height="240"
                    style={styles.itemImage}
                  />
                </Column>
                <Column style={{ verticalAlign: "top" }}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Text style={{ ...styles.textSecondary, margin: "0" }}>
                    Quantity: {item.quantity} ×{" "}
                    {item.compare_at_unit_price && (
                      <>
                        <span style={styles.strikethrough}>
                          {formatCurrency(
                            item.compare_at_unit_price,
                            currencyCode
                          )}
                        </span>{" "}
                      </>
                    )}
                    {formatCurrency(item.total, currencyCode)}
                  </Text>
                </Column>
              </Row>
            ))}

            <Section style={{ margin: "24px 0" }}>
              <Row style={styles.summaryRow}>
                <Column>
                  <Text style={styles.summaryText}>Subtotal (incl. VAT)</Text>
                </Column>
                <Column align="right">
                  <Text style={styles.summaryText}>
                    {formatCurrency(itemSubtotal, currencyCode)}
                  </Text>
                </Column>
              </Row>
              <Row style={styles.summaryRow}>
                <Column>
                  <Text style={styles.summaryText}>Discount Total</Text>
                </Column>
                <Column align="right">
                  <Text style={styles.summaryText}>
                    {formatCurrency(discountTotal, currencyCode)}
                  </Text>
                </Column>
              </Row>
              <Row style={styles.summaryRow}>
                <Column>
                  <Text style={styles.summaryText}>Shipping Total</Text>
                </Column>
                <Column align="right">
                  <Text style={styles.summaryText}>
                    {formatCurrency(shippingTotal, currencyCode)}
                  </Text>
                </Column>
              </Row>
              <Row style={styles.summaryRow}>
                <Column>
                  <Text style={styles.summaryTextBold}>Total</Text>
                </Column>
                <Column align="right">
                  <Text style={styles.summaryTextBold}>
                    {formatCurrency(total, currencyCode)}
                  </Text>
                </Column>
              </Row>
              <Row style={styles.summaryRow}>
                <Column>
                  <Text style={styles.summaryTextItalic}>VAT Amount</Text>
                </Column>
                <Column align="right">
                  <Text style={styles.summaryTextItalic}>
                    {formatCurrency(taxTotal, currencyCode)}
                  </Text>
                </Column>
              </Row>
            </Section>
          </Section>

          <Hr style={styles.hr} />

          <Section>
            <Text style={styles.heading}>Shipping Address</Text>
            <Section style={{ margin: "24px 0" }}>
              <Text style={styles.text}>
                {shippingAddress.first_name} {shippingAddress.last_name}
              </Text>
              <Text style={styles.text}>{shippingAddress.address_1}</Text>
              {shippingAddress.address_2 && (
                <Text style={styles.text}>{shippingAddress.address_2}</Text>
              )}
              <Text style={styles.text}>
                {shippingAddress.postal_code} {shippingAddress.city}
              </Text>
              <Text style={styles.text}>
                {shippingAddress.country_code.toUpperCase()}
              </Text>
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
