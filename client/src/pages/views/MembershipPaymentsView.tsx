import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import MembershipBalanceView from "./MembershipBalanceView";
import MembershipFollowupView from "./MembershipFollowupView";

export function MembershipPaymentsView({ token }: { token: string }) {
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).get("view") === "followup" ? "followup" : "balance",
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Send from accounts@innercirclegroup.com.au, with a copy in the accounts Sent folder.
        Raul is included in CC. Review the full email and recipients before sending.
      </p>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="balance">Balance due</TabsTrigger>
          <TabsTrigger value="followup">Payment follow-up</TabsTrigger>
        </TabsList>
        <TabsContent value="balance"><MembershipBalanceView token={token} /></TabsContent>
        <TabsContent value="followup"><MembershipFollowupView token={token} /></TabsContent>
      </Tabs>
    </div>
  );
}
