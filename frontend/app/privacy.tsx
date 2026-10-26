/**
 * The privacy notice.
 *
 * This is the document the login screen asserts you agree to. It said that
 * before this file existed, which is the reason it exists.
 *
 * It is written against what the code actually does, not against a template:
 * the field list below is the user document in backend/models.py, and the
 * erasure description is core/erasure.py. If either changes, this changes,
 * and PRIVACY_NOTICE_VERSION in backend/core/config.py is bumped so that
 * consent recorded against the old wording is distinguishable.
 *
 * It is not a lawyer's work and does not pretend to be. It is an accurate
 * description of the system, which is the part only we can write.
 */
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";

export const NOTICE_VERSION = "2026-10-26";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      {children}
    </View>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={styles.p}>{children}</Text>;
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.item}>
      <Text style={styles.bullet}>•</Text>
      <Text style={styles.p}>{children}</Text>
    </View>
  );
}

export default function Privacy() {
  const insets = useSafeAreaInsets();
  return (
    <>
      <Stack.Screen options={{ title: "Privacy", headerShown: true }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
      >
        <Text style={styles.h1}>Privacy notice</Text>
        <Text style={styles.meta}>Version {NOTICE_VERSION}</Text>

        <P>
          Explore91 is operated from India and this notice is written to meet the
          Digital Personal Data Protection Act, 2023. We are the Data Fiduciary
          for the data described here. It describes what the app actually
          collects, which is deliberately very little.
        </P>

        <Section title="What we collect">
          <Item>Your email address, which identifies your account.</Item>
          <Item>A display name, if you give one. It appears on reviews you write.</Item>
          <Item>The city you choose to browse.</Item>
          <Item>
            Things you do in the app: places you save, reels you like, cities you
            mark as visited, bookings you make and reviews you write.
          </Item>
          <Item>
            A confirmation that you are 18 or older, asked once when you sign up.
          </Item>
        </Section>

        <Section title="What we do not collect">
          <Item>
            Your location. The app never asks for it and contains no location
            code.
          </Item>
          <Item>Your contacts, photos, microphone or camera.</Item>
          <Item>Advertising identifiers. There are no third-party trackers.</Item>
          <Item>Payment details. There are no payments in the app today.</Item>
        </Section>

        <Section title="Why we use it">
          <P>
            To create and keep your account, to show places and reels for the
            city you chose, and to answer support requests you raise. Nothing
            else. We do not sell personal data and we do not use it to target
            advertising.
          </P>
        </Section>

        <Section title="Who else sees it">
          <P>
            Our hosting and database providers process data on our behalf under
            contract: Google Cloud (Mumbai region), MongoDB Atlas and Vercel.
            Businesses you review see the review and the display name you chose.
            We do not share your email address with them.
          </P>
        </Section>

        <Section title="Your rights">
          <Item>
            <Text style={styles.strong}>Access.</Text> Ask us what we hold about
            you.
          </Item>
          <Item>
            <Text style={styles.strong}>Correction.</Text> Change your name or
            city in the app at any time.
          </Item>
          <Item>
            <Text style={styles.strong}>Erasure.</Text> Delete your account from
            Profile. It is immediate and cannot be undone. Your account, sessions,
            saved places, likes, visits and support tickets are deleted outright.
            Reviews and bookings stay with the business but stop being linked to
            you: your name is removed and the record is re-keyed so it cannot be
            traced back. Business listings you administer become unclaimed rather
            than being deleted.
          </Item>
          <Item>
            <Text style={styles.strong}>Withdraw consent.</Text> Deleting your
            account withdraws it. There is nothing we keep processing afterwards.
          </Item>
          <Item>
            <Text style={styles.strong}>Grievance.</Text> Write to us at the
            address below. We will respond.
          </Item>
        </Section>

        <Section title="Children">
          <P>
            Explore91 is for adults. The Act requires verifiable parental consent
            before processing the data of anyone under 18, and we are not set up
            to obtain it, so we ask you to confirm you are 18 or older when you
            sign up. If you believe a child has created an account, write to us
            and we will delete it.
          </P>
        </Section>

        <Section title="How long we keep it">
          <P>
            Sign-in sessions expire after 7 days. Everything else is kept while
            your account exists and is deleted when you delete it.
          </P>
        </Section>

        <Section title="Contact">
          <P>privacy@explore91.com</P>
          <P>
            If you are not satisfied with our response you may complain to the
            Data Protection Board of India.
          </P>
        </Section>

        <Text style={styles.footer}>
          If this notice changes materially we will ask you to agree to the new
          version rather than quietly replacing it.
        </Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  h1: { fontFamily: fonts.display, fontSize: tType.xxl, color: colors.onSurface },
  meta: {
    fontFamily: fonts.body, fontSize: tType.sm, color: colors.onSurfaceTertiary,
    marginTop: spacing.xs, marginBottom: spacing.lg,
  },
  section: { marginTop: spacing.xl },
  h2: {
    fontFamily: fonts.displaySemi, fontSize: tType.lg, color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  p: {
    flex: 1, fontFamily: fonts.body, fontSize: tType.base,
    color: colors.onSurfaceSecondary, lineHeight: 22,
  },
  strong: { fontFamily: fonts.bodySemi, color: colors.onSurface },
  item: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  bullet: { color: colors.brandPrimary, fontSize: tType.base, lineHeight: 22 },
  footer: {
    fontFamily: fonts.body, fontSize: tType.sm, color: colors.onSurfaceTertiary,
    marginTop: spacing.xl, lineHeight: 20, borderTopWidth: 1,
    borderTopColor: colors.border, paddingTop: spacing.lg, borderRadius: radius.sm,
  },
});
