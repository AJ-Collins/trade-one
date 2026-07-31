import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle, Clock, AlertCircle, Upload, FileText } from "lucide-react";
import api from "../../lib/api";
import type { KYCStatus as KYCStatusType, KYCSubmission } from "../../types/index";

interface KYCStatusProps {
  onStatusChange?: (status: string) => void;
}

export default function KYCStatus({ onStatusChange }: KYCStatusProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isResubmitting, setIsResubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch KYC status
  const { data: kycStatus, isLoading, refetch } = useQuery<KYCStatusType>({
    queryKey: ["kyc-status"],
    queryFn: async () => {
      const { data } = await api.get("/kyc/status");
      return data;
    },
  });

  // Fetch KYC submission history
  const { data: kycHistory } = useQuery({
    queryKey: ["kyc-history"],
    queryFn: async () => {
      const { data } = await api.get("/kyc/history");
      return data;
    },
    enabled: showHistory,
  });

  // Submit KYC mutation
  const kycMutation = useMutation({
    mutationFn: async (data: { files: File[]; isResubmit: boolean }) => {
      const formData = new FormData();
      data.files.forEach((file) => formData.append("documents", file));
      const endpoint = data.isResubmit ? "/kyc/resubmit" : "/kyc/submit";
      const response = await api.post(endpoint, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data;
    },
    onSuccess: (data) => {
      refetch();
      onStatusChange?.(data.status);
      setIsSubmitting(false);
      setIsResubmitting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (error) => {
      console.error("KYC submission failed:", error);
      setIsSubmitting(false);
      setIsResubmitting(false);
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length !== 2) {
      alert("Please select exactly 2 documents (ID front and back)");
      return;
    }
    setIsSubmitting(true);
    await kycMutation.mutateAsync({ files, isResubmit: isResubmitting });
  };

  if (isLoading) {
    return (
      <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6 animate-pulse">
        <div className="h-24 bg-[#1a1f28] rounded-lg" />
      </div>
    );
  }

  const statusInfo = {
    UNVERIFIED: {
      icon: AlertCircle,
      color: "text-orange-400",
      bgColor: "bg-orange-400/10",
      borderColor: "border-orange-400/30",
      title: "Unverified",
      description: "Submit your documents to start the verification process",
    },
    PENDING: {
      icon: Clock,
      color: "text-yellow-400",
      bgColor: "bg-yellow-400/10",
      borderColor: "border-yellow-400/30",
      title: "Under Review",
      description: "Your KYC documents are being reviewed by our team",
    },
    VERIFIED: {
      icon: CheckCircle,
      color: "text-[#39ff88]",
      bgColor: "bg-[#39ff88]/10",
      borderColor: "border-[#39ff88]/30",
      title: "Verified",
      description: "Your identity has been verified. You can withdraw without limits",
    },
  };

  const currentStatus = kycStatus?.status || "UNVERIFIED";
  const info = statusInfo[currentStatus];
  const Icon = info.icon;

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <div className={`${info.bgColor} border ${info.borderColor} rounded-2xl p-6`}>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <Icon className={`h-6 w-6 ${info.color} flex-shrink-0 mt-1`} />
            <div>
              <h3 className={`text-lg font-bold ${info.color}`}>{info.title}</h3>
              <p className="text-xs text-gray-400 mt-1">{info.description}</p>
            </div>
          </div>
        </div>

        {/* Status-specific actions */}
        {currentStatus !== "VERIFIED" && (
          <div className="mt-4 space-y-3">
            {currentStatus === "UNVERIFIED" && (
              <>
                <p className="text-xs text-gray-500 bg-[#05070a] rounded-lg p-3">
                  Upload 2 documents: ID front and back (JPG, PNG, PDF - max 5MB each)
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                  className="w-full bg-[#39ff88] text-[#05070a] font-bold text-xs py-2.5 rounded-lg hover:bg-[#5dffa1] transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <Upload className="h-4 w-4" />
                  {isSubmitting ? "Uploading..." : "Upload Documents"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </>
            )}

            {currentStatus === "PENDING" && (
              <p className="text-xs text-yellow-400 bg-[#05070a] rounded-lg p-3">
                Verification typically takes 24-48 hours. Check back soon!
              </p>
            )}
          </div>
        )}

        {/* View History Button */}
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="text-xs text-gray-400 hover:text-[#39ff88] transition-colors mt-4 flex items-center gap-1"
        >
          <FileText className="h-3 w-3" />
          {showHistory ? "Hide" : "View"} submission history
        </button>
      </div>

      {/* Submission History */}
      {showHistory && kycHistory?.submissions && kycHistory.submissions.length > 0 && (
        <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-4 space-y-3">
          <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider">
            Submission History ({kycHistory.count})
          </h4>
          {kycHistory.submissions.map((submission: KYCSubmission, idx: number) => (
            <div key={submission.id} className="bg-[#05070a] rounded-lg p-3 border border-[#1a1f28]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-300">
                  Submission #{idx + 1}
                </span>
                <span
                  className={`text-xs font-bold px-2 py-1 rounded ${
                    submission.status === "APPROVED"
                      ? "bg-[#39ff88]/20 text-[#39ff88]"
                      : submission.status === "REJECTED"
                        ? "bg-red-500/20 text-red-400"
                        : "bg-yellow-400/20 text-yellow-400"
                  }`}
                >
                  {submission.status}
                </span>
              </div>
              <p className="text-[11px] text-gray-500">
                Submitted: {new Date(submission.submittedAt).toLocaleDateString()}
              </p>
              {submission.adminNotes && (
                <p className="text-[11px] text-gray-400 mt-1 italic">
                  Note: {submission.adminNotes}
                </p>
              )}
              {submission.status === "REJECTED" && (
                <button
                  onClick={() => {
                    setIsResubmitting(true);
                    fileInputRef.current?.click();
                  }}
                  className="text-[11px] text-[#39ff88] hover:underline mt-2"
                >
                  Resubmit Documents
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
